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
  let unique = (array) => <string[]>[...new Set(array)];
  return(unique(artifacts));
}


// Given a PR and commit sha, fetch a list of the artifacts
async function fetchPRShaArtifacts(issue, sha) {
  const URL = 'https://api.github.com/repos/bioconda/bioconda-recipes/commits/' + sha + '/check-runs';
  let crs = {};
  var artifacts:string[] = [];

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
      let packageMatch = (<string> itemNever).match(/^(.+)\/(.+)\/(.+\.tar\.bz2)$/);
      if(packageMatch) {
        let [url, basedir, subdir, packageName] = packageMatch
        let repoURL = [basedir, subdir, "repodata.json"].join("/");
        let condaInstallURL = basedir;

        if(subdir === "noarch") {
          comment += "noarch |";
          installNoarch = "```\nconda install -c " + condaInstallURL + " <package name>\n```\n";
        } else if(subdir === "linux-64") {
          comment += "linux-64 |";
          installLinux = "```\nconda install -c " + condaInstallURL + " <package name>\n```\n";
        } else {
          comment += "osx-64 |";
          installOSX = "```\nconda install -c " + condaInstallURL + " <package name>\n```\n";
        }
        comment += " [" + packageName + "](" + url + ") | [repodata.json](" + repoURL + ")\n";
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
    await sendComment(PR, "No artifacts found on the most recent CircleCI build. Either the build failed or the recipe was blacklisted/skipped.");
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
    await sendComment(PR, "Reposting for @" + user + " to enable pings (courtesy of the BiocondaBot):\n\n> " + s);
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
  await exec.exec("git", ["clone", "git@github.com:" + remoteRepo + ".git"]);
  process.chdir('bioconda-recipes');

  // Add/pull upstream
  await exec.exec("git", ["remote", "add", "brmaster", "https://github.com/bioconda/bioconda-recipes"]);
  await exec.exec("git", ["pull", "brmaster", "master"]);

  // Merge
  await exec.exec("git", ["checkout", remoteBranch]);
  await exec.exec("git", ["merge", "master"]);

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
  await exec.exec("/home/runner/miniconda/bin/conda", ["create", "-y", "-c", "conda-forge", "-c", "bioconda", "-n", "bioconda", "bioconda-utils", "anaconda-client", "python=3.7"]);
}


// Ensure uploaded containers are in repos that have public visibility
async function toggleVisibility(x) {
  var URL = "https://quay.io/api/v1/repository/biocontainers/" + x + "/changevisibility";
  const body = {'visibility': 'public'};
  var rc = 0;
  try{
    await request.post({
      'url': URL,
      'headers': {'Authorization': 'Bearer ' + process.env['QUAY_OAUTH_TOKEN'],
                  'Content-Type': 'application/json'},
      'body': body,
      'json': true
    }, function(e, r, b) {
      rc = r.statusCode;
    });
  } catch(e) {
    // Do nothing
  }
  console.log("Trying to toggle visibility (" + URL + ") returned " + rc);
}


// Download an artifact from CircleCI, rename and upload it
async function downloadAndUpload(x) {
  const ANACONDA_TOKEN = process.env['ANACONDA_TOKEN'];
  const loc = await tc.downloadTool(x);

  // Rename
  const options = {force: true};
  var newName = x.split("/").pop();
  var imageName = newName.replace("%3A", ":").replace("\n", "").replace(".tar.gz", "");
  newName = newName.replace("%3A", "_").replace("\n", "");  // the tarball needs a regular name without :, the container needs pkg:tag
  await io.mv(loc, newName);

  if(x.endsWith(".gz")) { // Container
    console.log("uploading with skopeo newName " + newName );
    // This can fail, retry with 5 second delays
    var count = 0;
    var maxTries = 5;
    var success = false;
    while(count < maxTries) {
      try {
        await exec.exec("/home/runner/miniconda/envs/bioconda/bin/skopeo", [
          "--insecure-policy",
          "--command-timeout", "600s",
          "copy",
          "docker-archive:" + newName,
          "docker://quay.io/biocontainers/" + imageName,
          "--dest-creds", process.env['QUAY_LOGIN']]);
        success = true;
        break;
      } catch(e) {
        if (++count == maxTries) throw e;
        await delay(5000);
      }
    }
    if(success) {
      await toggleVisibility(x.split("/").pop().split("%3A")[0]);
    }
  } else if(x.endsWith(".bz2")) { // Package
    console.log("uploading package");
    await exec.exec("/home/runner/miniconda/envs/bioconda/bin/anaconda", ["-t", ANACONDA_TOKEN, "upload", newName, "--force"]);
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
  assert(artifacts.length > 0);

  // Install bioconda-utils
  await installBiocondaUtils();

  // Download/upload Artifacts
  await asyncForEach(artifacts, downloadAndUpload);

  return sha;
}


// Assume we have no more than 250 commits in a PR, which is probably reasonable in most cases
async function getPRCommitMessages(issueNumber) {
  const TOKEN = process.env['BOT_TOKEN'];
  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/pulls/" + issueNumber + "/commits";
  var commits = [];
  await request.get({
    'url': URL,
    'headers': {'Authorization': 'token ' + TOKEN,
                'User-Agent': 'BiocondaCommentResponder'}
    }, function(e, r, b) {
      commits = JSON.parse(b);
    });

  var msg = commits.reverse().map(x => " * " + x['commit']['message'] + "\n").join("");

  return msg;
};


// Merge a PR
async function mergePR(PR) {
  const TOKEN = process.env['BOT_TOKEN'];
  await sendComment(PR, "I will attempt to upload artifacts and merge this PR. This may take some time, please have patience.");

  try {
    var mergeable = await checkIsMergeable(PR);
    console.log("mergeable state of " + PR + " is " + mergeable);
    if(!mergeable) {
      await sendComment(PR, "Sorry, this PR cannot be merged at this time.");
    } else {
      console.log("uploading artifacts");
      var sha = await uploadArtifacts(PR);
      console.log("artifacts uploaded");

      // Carry over last 250 commit messages
      var msg = await getPRCommitMessages(PR);

      // Hit merge
      var URL = "https://api.github.com/repos/bioconda/bioconda-recipes/pulls/" + PR + "/merge";
      const payload = {'sha': sha,
                       'commit_title': '[ci skip] Merge PR ' + PR,
                       'commit_message': 'Merge PR #' + PR + ', commits were: \n' + msg,
                       'merge_method': 'squash'};
      console.log("Putting merge commit");
      await request.put({'url': URL,
                         'headers': {'Authorization': 'token ' + TOKEN,
                                     'User-Agent': 'BiocondaCommentResponder'},
                         'body': payload,
                         'json': true}, function(e, r, b) {
            console.log("body " + b);
            console.log("mergePR the response code was " + r.statusCode);
            });
    }
  } catch(e) {
    await sendComment(PR, "I received an error uploading the build artifacts or merging the PR!");
  }
}


// Add the "Please review and merge" label to a PR
async function addPRLabel(PR) {
  const TOKEN = process.env['BOT_TOKEN'];
  var URL = "https://api.github.com/repos/bioconda/bioconda-recipes/issues/" + PR + "/labels";
  const payload = {'labels': ["please review & merge"]};
  await request.post({'url': URL,
                      'headers': {'Authorization': 'token ' + TOKEN,
                                  'User-Agent': 'BiocondaCommentResponder'},
                      'body': payload,
                      'json': true});
}


async function gitterMessage(msg) {
  const TOKEN = process.env['GITTER_TOKEN'];
  var roomID = "57f3b80cd73408ce4f2bba26";
  var URL = "https://api.gitter.im/v1/rooms/" + roomID + "/chatMessages"

  console.log("Sending request to " + URL);
  await request.post({
    'url': URL,
    'headers': {'Authorization': 'Bearer ' + TOKEN,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'BiocondaCommentResponder'},
    'json': true,
    'body': {'text': msg}
    });
}


async function notifyReady(PR) {
  try {
    await gitterMessage("PR ready for review: https://github.com/bioconda/bioconda-recipes/pull/" + PR);
  } catch(error) {
    console.log(error);
    // Do not die if we can't post to gitter!
  }
}


// This requires that a JOB_CONTEXT environment variable, which is made with `toJson(github)`
async function run() {
  const jobContext = JSON.parse(<string> process.env['JOB_CONTEXT']);
  console.log(jobContext);
  if(jobContext['event']['issue']['pull_request'] !== undefined) {
    const issueNumber = <string> jobContext['event']['issue']['number'];

    const originalComment = <string> jobContext['event']['comment']['body'];
    console.log('the comment is: ' + originalComment);

    const comment = originalComment.toLowerCase()
    if(comment.startsWith('@bioconda-bot') || comment.startsWith('@biocondabot')) {
      // Cases that need to be implemented are:
      //   please merge
      if(comment.includes('please update')) {
        updateFromMaster(issueNumber);
      } else if(comment.includes(' hello')) {
        await sendComment(issueNumber, "Yes?");
      } else if(comment.includes(' please fetch artifacts') || comment.includes(' please fetch artefacts')) {
        await artifactChecker(issueNumber);
      } else if(comment.includes(' please merge')) {
        await mergePR(issueNumber);
      } else if(comment.includes(' please add label')) {
        await addPRLabel(issueNumber);
        await notifyReady(issueNumber);
      //} else {
        // Methods in development can go below, flanked by checking who is running them
        //if(jobContext['actor'] != 'dpryan79') {
        //  console.log('skipping');
        //  process.exit(0);
        //}
      }
    } else if(comment.includes('@bioconda/')) {
      await commentReposter(jobContext['actor'], issueNumber, originalComment);
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
