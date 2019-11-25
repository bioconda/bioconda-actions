const core = require('@actions/core');
const exec = require('@actions/exec');
const request = require('request-promise-native');
const io = require('@actions/io');
const tc = require('@actions/tool-cache');
var assert = require('assert');
var fs = require('fs');


function requestCallback(error, response, body) {
  console.log("the response code was " + response.statusCode);
  if (error || response.statusCode < 200 || response.statusCode > 202) {
    process.exit(1)
  }
}


// Post a comment on a given issue/PR with text in s
async function sendComment(issueNumber, s) {
  const TOKEN = process.env['BOT_TOKEN'];

  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/issues/" + issueNumber + "/comments";
  await request.post({
    'url': URL,
    'headers': {'Authorization': 'token ' + TOKEN,
                'User-Agent': 'BiocondaCommentResponder'},
    'json': {
      body: s
    }}, requestCallback);
}


// Parse the summary string returned by github to get the CircleCI run ID
function parseCircleCISummary(s) {
  var regex = /gh\/bioconda\/bioconda-recipes\/(\d+)/gm;
  let array = [...s.matchAll(regex)];
  const IDs = array.map(x => x[1]);
  return IDs;
}


// Given a CircleCI run ID, return a list of its tarball artifacts
async function fetchArtifacts(ID) {
  let res = "";
  let rc = 0;

  const URL = "https://circleci.com/api/v1.1/project/github/bioconda/bioconda-recipes/" + ID + "/artifacts";
  console.log("contacting circleci " + URL);
  await request.get({
    'url': URL,
    }, function(e, r, b) {
      rc = r.statusCode;
      res += b });

  // Sometimes we get a 301 error, so there are no longer artifacts available
  console.log("status code was " + rc);
  if(rc == 301 || res.length < 3) {
    return([]);
  }

  res = res.replace("(", "[").replace(")", "]");
  res = res.replace(/} /g, "}, ");
  res = res.replace(/:node-index/g, "\"node-index\":");
  res = res.replace(/:path/g, "\"path\":");
  res = res.replace(/:pretty-path/g, "\"pretty-path\":");
  res = res.replace(/:url/g, "\"url\":");
  let artifacts = JSON.parse(res).filter(x => x['url'].endsWith(".tar.gz") || x['url'].endsWith(".tar.bz2") || x['url'].endsWith("/repodata.json")).map(x => x['url']);
  return(artifacts);
}


// Given a PR and commit sha, fetch a list of the artifacts
async function fetchPRShaArtifacts(issue, sha) {
  const URL = 'https://api.github.com/repos/bioconda/bioconda-recipes/commits/' + sha + '/check-runs';
  let crs = {};
  var artifacts = [];

  await request.get({
    'url': URL,
    'headers': {'User-Agent': 'BiocondaCommentResponder',
                'Accept': 'application/vnd.github.antiope-preview+json'},
    }, function(e, r, b) { crs = JSON.parse(b) });

  for(const idx of Array(crs['check_runs'].length).keys()) {
    let cr = crs['check_runs'][idx];
    if(cr['output']['title'] == 'Workflow: bioconda-test') {
      // The circleci IDs are embedded in a string in output:summary
      let IDs = parseCircleCISummary(cr['output']['summary']);
      for(const idx2 of Array(IDs.length).keys()) {
        let item = IDs[idx2];
        var foo = await fetchArtifacts(item);
        artifacts = artifacts.concat(foo);
      }
    }
  };
  return(artifacts);
}


// Given a PR and commit sha, post a comment with any artifacts
async function makeArtifactComment(PR, sha) {
  let artifacts = await fetchPRShaArtifacts(PR, sha);
  let nPackages = artifacts.filter(function(y) { var x = <string> y; return(x.endsWith(".tar.bz2") || x.endsWith("tar.gz")) }).length

  if(nPackages) {
    // If a package artifact is found, the accompanying repodata is the preceeding item in artifacts
    var noarch = [];
    var linux = [];
    var osx = [];
    var containers = [];
    var comment = "Package(s) built on CircleCI are ready for inspection:\n\n";
    comment += "Arch | Package | Repodata\n-----|---------|---------\n";
    var installNoarch = "";
    var installLinux = "";
    var installOSX = "";

    // Table of packages and repodata.json
    artifacts.forEach(function(itemNever, idx, arr) {
      var item = <string> itemNever;
      if(item.endsWith(".tar.bz2")) {
        let packageName = item.split("/").pop();
        let repoURL = arr[idx - 1];
        let condaInstallURL = item.split("/packages/")[0] + "/packages";

        if(item.includes("/packages/noarch/")) {
          comment += "noarch |";
          installNoarch += "```\nconda install -c " + condaInstallURL + " <package name>\n```\n";
        } else if(item.includes("/packages/linux-64/")) {
          comment += "linux-64 |";
          installLinux += "```\nconda install -c " + condaInstallURL + " <package name>\n```\n";
        } else {
          comment += "osx-64 |";
          installOSX += "```\nconda install -c " + condaInstallURL + " <package name>\n```\n";
        }
        comment += " [" + packageName + "](" + item + ") | [repodata.json](" + repoURL + ")\n";
      }
    });

    // Conda install examples
    comment += "***\n\nYou may also use `conda` to install these:\n\n";
    if(installNoarch.length) {
        comment += " * For packages on noarch:\n" + installNoarch;
    }
    if(installLinux.length) {
        comment += " * For packages on linux-64:\n" + installLinux;
    }
    if(installOSX.length) {
        comment += " * For packages on osx-64:\n" + installOSX;
    }

    // Table of containers
    comment += "***\n\nDocker image(s) built:\n\n";
    comment += "Package | Tag | Install with `docker`\n";
    comment += "--------|-----|----------------------\n";

    artifacts.forEach(function(itemNever, idx, arr) {
      var item = <string> itemNever;
      if(item.endsWith(".tar.gz")) {
        let imageName = item.split("/").pop();
        if(imageName !== undefined) {
          let packageName = imageName.split("%3A")[0];
          let tag = imageName.split("%3A")[1].replace(".tar.gz", "");
          comment += "[" + packageName + "](" + item + ") | " + tag + " | ";
          comment += "<details><summary>show</summary>`curl \"" + item + "\" \\| gzip -dc \\| docker load`\n";
        }
      }
    });
    comment += "\n\n";
    await sendComment(PR, comment);

  } else {
    console.log("No packages");
    await sendComment(PR, "No artifacts found on the most recent CircleCI build. Either the build failed or the recipe was blacklisted/skipped. -The Bot");
  }
}


// Post a comment on a given PR with its CircleCI artifacts
async function artifactChecker(issueNumber) {
  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/pulls/" + issueNumber;
  let PRinfo = {};
  await request.get({
    'url': URL,
    'headers': {'User-Agent': 'BiocondaCommentResponder'}
    }, function(e, r, b) {
      PRinfo = JSON.parse(b);
    });

  await makeArtifactComment(issueNumber, PRinfo['head']['sha']);
}


// Return true if a user is a member of bioconda
async function isBiocondaMember(user) {
  const TOKEN = process.env['BOT_TOKEN'];
  const URL = "https://api.github.com/orgs/bioconda/members/" + user;
  var rv = 404;
  try{
  await request.get({
    'url': URL,
    'headers': {'Authorization': 'token ' + TOKEN,
                'User-Agent': 'BiocondaCommentResponder'}
    }, function(e, r, b) {
      rv = r.statusCode;
      console.log("I got called rv " + rv);
    });
  } catch(e) {
    // Do nothing, this just prevents things from crashing on 404
  }

  if(rv == 204) {
    return(true);
  }
  return(false);
}


// Reposts a quoted message in a given issue/PR if the user isn't a bioconda member
async function commentReposter(user, PR, s) {
  if(!await isBiocondaMember(user)) {
    console.log("Reposting for " + user);
    await sendComment(PR, "Reposting to enable pings (courtesy of the BiocondaBot):\n\n> " + s);
  } else {
    console.log("Not reposting for " + user);
  }
}


// Fetch and return the JSON of a PR
// This can be run to trigger a test merge
async function getPRInfo(PR) {
  const TOKEN = process.env['BOT_TOKEN'];
  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/pulls/" + PR;

  let res = {};
  await request.get({
    'url': URL,
    'headers': {'Authorization': 'token ' + TOKEN,
                'User-Agent': 'BiocondaCommentResponder'}
    }, function(e, r, b) {
        res = JSON.parse(b);
    });

  return res;
}


// Update a branch from upstream master, this should be run in a try/catch
async function updateFromMasterRunner(PR) {
  // Setup git, otherwise we can't push
  await exec.exec("git", ["config", "--global", "user.email", "biocondabot@gmail.com"]);
  await exec.exec("git", ["config", "--global", "user.name", "BiocondaBot"]);

  var PRInfo = await getPRInfo(PR);
  var remoteBranch = PRInfo['head']['ref'];  // Remote branch
  var remoteRepo = PRInfo['head']['repo']['full_name'];  // Remote repo

  // Clone
  console.log("git clone");
  await exec.exec("git", ["clone", "git@github.com:" + remoteRepo + ".git"]);
  process.chdir('bioconda-recipes');

  // Add/pull upstream
  console.log("git pull upstream");
  await exec.exec("git", ["remote", "add", "brmaster", "https://github.com/bioconda/bioconda-recipes"]);
  await exec.exec("git", ["pull", "brmaster", "master"]);

  // Merge
  console.log("git merge");
  await exec.exec("git", ["checkout", remoteBranch]);
  await exec.exec("git", ["merge", "master"]);

  console.log("git push");
  await exec.exec("git", ["push"]);
}


// Merge the upstream master branch into a PR branch, leave a message on error
async function updateFromMaster(PR) {
  try {
    await updateFromMasterRunner(PR);
  } catch(e) {
    await sendComment(PR, "I encountered an error updating your PR branch. You can report this to bioconda/core if you'd like.\n-The Bot");
    process.exit(1);
  }
}


// From stackoverflow: https://stackoverflow.com/a/37764963/4716976
function delay(ms) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}


// A wrapper around isBiocondaMember to make things easier
async function isBiocondaMemberWrapper(x) {
  console.log(x['user']['login']);
  return await isBiocondaMember(x['user']['login']);
}


// Ensure there's at least one approval by a member
async function approvalReview(issueNumber) {
  const TOKEN = process.env['BOT_TOKEN'];
  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/pulls/" + issueNumber + "/reviews";
  var reviews = [];
  await request.get({
    'url': URL,
    'headers': {'Authorization': 'token ' + TOKEN,
                'User-Agent': 'BiocondaCommentResponder'}
    }, function(e, r, b) {
      reviews = JSON.parse(b);
    });

  reviews = reviews.filter(x => x['state'] == 'APPROVED');
  if(reviews.length == 0) {
    return false;
  }

  // Ensure the review author is a member
  return reviews.some(await isBiocondaMemberWrapper);
}


// Check the mergeable state of a PR
async function checkIsMergeable(issueNumber, secondTry=false) {
  const TOKEN = process.env['BOT_TOKEN'];
  if(secondTry) {  // Sleep 5 seconds to allow the background process to finish
    await delay(3000);
  }

  // PR info
  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/pulls/" + issueNumber;
  var PRinfo = {};
  await request.get({
    'url': URL,
    'headers': {'Authorization': 'token ' + TOKEN,
                'User-Agent': 'BiocondaCommentResponder'}
    }, function(e, r, b) {
      PRinfo = JSON.parse(b);
    });

  // We need mergeable == true and mergeable_state == clean, an approval by a member and
  if(PRinfo['mergeable'] === null && !secondTry) {
    return await checkIsMergeable(issueNumber, true);
  } else if(PRinfo['mergeable'] === null || !PRinfo['mergeable'] || PRinfo['mergeable_state'] != 'clean') {
    return false;
  }

  return await approvalReview(issueNumber);
}


async function installBiocondaUtils() {
  var URL = "https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh";

  // Step 1: Download and install conda
  // Otherwise conda can't install for some reason
  await io.mkdirP('/home/runner/.conda');
  const installerLocation = await tc.downloadTool(URL);
  await exec.exec("bash", [installerLocation, "-b", "-p", "/home/runner/miniconda"]);

  // Step 2: Create env with bioconda-utils
  await exec.exec("/home/runner/miniconda/bin/conda", ["create", "-y", "-c", "conda-forge", "-c", "bioconda", "-n", "bioconda", "bioconda-utils", "anaconda-client"]);
}


// Load a tarball into docker and return the container name
async function loadImage(x) {
  var imageName = "";
  const options = { listeners: {
    stdout: (data: Buffer) => {
      imageName += data.toString();
    }
  }};
  await exec.exec("docker", ["load", "-qi", x], options);
  imageName = imageName.replace("Loaded image: ", "").trim().replace("quay.io/biocontainers/", "");
  console.log("imageName is " + imageName);
  return imageName;
}


// Download an artifact from CircleCI, rename and upload it
async function downloadAndUpload(x) {
  const QUAY_TOKEN = process.env['QUAY_OAUTH_TOKEN'];
  const ANACONDA_TOKEN = process.env['ANACONDA_TOKEN'];
  const loc = await tc.downloadTool(x);
  console.log(x + " is named " + loc);

  // Rename
  const options = {force: true};
  var newName = x.split("/").pop();
  newName = newName.replace("%3A", "_").replace("\n", "");
  await io.mv(loc, newName);

  if(x.endsWith(".gz")) { // Container
//    var imageName = await loadImage(newName);
//    console.log("uploading container " + imageName + " EOL");
//    await exec.exec("/home/runner/miniconda/envs/bioconda/bin/mulled-build", ["push", imageName, "--verbose", "-n", "biocontainers", "--oauth-token", QUAY_TOKEN]);
//    await exec.exec("docker", ["rmi", imageName]);
    console.log("uploading with skopeo newName " + newName );
    await exec.exec("/home/runner/miniconda/envs/bioconda/bin/skopeo", [
      "--insecure-policy",
      "--command-timeout", "600",
      "copy",
      "docker-archive:" + newName,
      "docker://quay.io/biocontainers/" + newName.replace(".tar.gz", "").replace(":", "="),
      "--dest-creds", process.env['QUAY_LOGIN']]);
  } else if(x.endsWith(".bz2")) { // Package
    console.log("uploading package");
    await exec.exec("/home/runner/miniconda/envs/bioconda/bin/anaconda", ["-t", ANACONDA_TOKEN, "upload", newName]);
  }

  console.log("cleaning up");
  await io.rmRF(x.split("/").pop());
}


// Courtesy of https://codeburst.io/javascript-async-await-with-foreach-b6ba62bbf404
async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}


// Upload artifacts to quay.io and anaconda, return the commit sha
// Only call this for mergeable PRs!
async function uploadArtifacts(PR) {
  // Get last sha
  var PRInfo = await getPRInfo(PR);
  var sha = PRInfo['head']['sha'];

  // Fetch the artifacts
  var artifacts = await fetchPRShaArtifacts(PR, sha);
  artifacts = artifacts.filter(x => String(x).endsWith(".gz") || String(x).endsWith(".bz2"));
  console.log(artifacts);
  assert(artifacts.length > 0);

  // Install bioconda-utils
  console.log("Installing bioconda-utils");
  await installBiocondaUtils();

  // Write ~/.involucro
  console.log("writing .involucro");
  await fs.writeFile('/home/runner/.involucro', '{\n  "auths": [\n    "' + process.env['INVOLUCRO_AUTH'] + '"\n  ]\n}\n', function(err) {
    if(err) throw err;
    console.log("updated!");
    });
  console.log("done");

  // Download/upload Artifacts
  console.log("Uploading artifacts");
  await asyncForEach(artifacts, downloadAndUpload);

  return sha;
}


// Merge a PR
async function mergePR(PR) {
  const TOKEN = process.env['BOT_TOKEN'];
//  await sendComment(PR, "I will attempt to upload artifacts and merge this PR. This may take some time, please have patience.");

  try {
    var mergeable = await checkIsMergeable(PR);
    console.log("mergeable state of " + PR + " is " + mergeable);
    if(!mergeable) {
      await sendComment(PR, "Sorry, this PR cannot be merged at this time.");
    } else {
      console.log("uploading artifacts");
      var sha = await uploadArtifacts(PR);

      // Hit merge
      var URL = "https://api.github.com/repos/bioconda/bioconda-recipes/pulls/" + PR + "/merge";
      const payload = {'sha': sha,
                       'commit_title': '[ci skip] Merge PR ' + PR,
                       'commit_message': 'Merge PR ' + PR,
                       'merge_method': 'squash'};
      await request.put({'url': URL,
                         'headers': {'Authorization': 'token ' + TOKEN,
                                     'User-Agent': 'BiocondaCommentResponder'},
                         'body': payload,
                         'json': true});
    }
  } catch(e) {
    await sendComment(PR, "I received an error uploading the build artifacts or merging the PR!");
  }
}


// This requires that a JOB_CONTEXT environment variable, which is made with `toJson(github)`
async function run() {
  const jobContext = JSON.parse(<string> process.env['JOB_CONTEXT']);
  console.log(jobContext);
  if(jobContext['event']['issue']['pull_request'] !== undefined) {
    const issueNumber = <string> jobContext['event']['issue']['number'];

    const comment = <string> jobContext['event']['comment']['body'];
    console.log('the comment is: ' + comment);

    if(comment.startsWith('@bioconda-bot')) {
      // Cases that need to be implemented are:
      //   please merge
      if(comment.includes('please update')) {
        updateFromMaster(issueNumber);
      } else if(comment.includes(' hello')) {
        await sendComment(issueNumber, "Yes?");
      } else if(comment.includes(' please fetch artifacts') || comment.includes(' please fetch artefacts')) {
        await artifactChecker(issueNumber);
      } else if(comment.includes(' please merge') && jobContext['actor'] == 'dpryan79') {
        await mergePR(issueNumber);

      //} else {
        // Methods in development can go below, flanked by checking who is running them
        //if(jobContext['actor'] != 'dpryan79') {
        //  console.log('skipping');
        //  process.exit(0);
        //}
      }
    } else if(comment.includes('@bioconda/')) {
      await commentReposter(jobContext['actor'], issueNumber, comment);
    }
  }
}


async function runRunner() {
  try {
    await run();
  } catch(e) {
    console.log("got an error");
    console.log(e);
    process.exit(1);
  }
}

runRunner();
