const core = require('@actions/core');
const exec = require('@actions/exec');
const request = require('request-promise-native');
const io = require('@actions/io');
const tc = require('@actions/tool-cache');
var assert = require('assert');
var fs = require('fs');



function requestCallback(error, response, body) {
  console.log("error is " + error + " with response code " + response.statusCode);
  if (error || response.statusCode < 200 || response.statusCode > 202) {
    process.exit(1)
  }
}


// Post a comment on a given issue/PR with text in s
async function sendComment(issueNumber, s) {
  const TOKEN = process.env['BOT_TOKEN'];

  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/issues/" + issueNumber + "/comments";
  console.log("Sending request");
  await request.post({
    'url': URL,
    'headers': {'Authorization': 'token ' + TOKEN,
                'User-Agent': 'BiocondaCommentResponder'},
    'json': {
      body: s
    }}, requestCallback);
  console.log("Request sent");
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
  const URL = "http://circleci.com/api/v1.1/project/github/bioconda/bioconda-recipes/" + ID + "/artifacts";
  console.log("contacting circleci " + URL);
  await request.get({
    'url': URL,
    }, function(e, r, b) {
      res += b });

  res = res.replace("(", "[").replace(")", "]");
  res = res.replace(/} /g, "}, ");
  res = res.replace(/:node-index/g, "\"node-index\":");
  res = res.replace(/:path/g, "\"path\":");
  res = res.replace(/:pretty-path/g, "\"pretty-path\":");
  res = res.replace(/:url/g, "\"url\":");
  res = JSON.parse(res);
  let artifacts = res.filter(x => x['url'].endsWith(".tar.gz") || x['url'].endsWith(".tar.bz2") || x['url'].endsWith("/repodata.json")).map(x => x['url']);
  return(artifacts);
}


// Given a PR and commit sha, fetch a list of the artifacts
async function fetchPRShaArtifacts(issue, sha) {
  const TOKEN = process.env['BOT_TOKEN'];

  const URL = 'https://api.github.com/repos/bioconda/bioconda-recipes/commits/' + sha + '/check-runs';
  let crs = {};

  await request.get({
    'url': URL,
    'headers': {'User-Agent': 'BiocondaCommentResponder',
                'Accept': 'application/vnd.github.antiope-preview+json'},
    }, function(e, r, b) { crs = JSON.parse(b) });

  var artifacts = [];
  for(const idx of Array(crs['check_runs'].length).keys()) {
    cr = crs['check_runs'][idx];
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
  console.log("Final artifact URLs: " + artifacts + "The length is " + artifacts.length);
  return(artifacts);
}


// Given a PR and commit sha, post a comment with any artifacts
async function makeArtifactComment(PR, sha) {
  let artifacts = await fetchPRShaArtifacts(PR, sha);
  let nPackages = artifacts.filter(x => x.endsWith(".tar.bz2") || x.endsWith("tar.gz")).length

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
    artifacts.forEach(function(item, idx, arr) {
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

    artifacts.forEach(function(item, idx, arr) {
      if(item.endsWith(".tar.gz")) {
        let imageName = item.split("/").pop();
        let packageName = imageName.split("%3A")[0];
        let tag = imageName.split("%3A")[1].replace(".tar.gz", "");
        comment += "[" + packageName + "](" + item + ") | " + tag + " | ";
        comment += "<details><summary>show</summary>`curl \"" + item + "\" \\| gzip -dc \\| docker load`\n";
      }
    });
    comment += "\n\n";
    await sendComment(PR, comment);

  } else {
    await sendComment(PR, "No artifacts found on the most recent CircleCI build. Either the build failed or the recipe was blacklisted/skipped.");
  }
}


// Post a comment on a given PR with its CircleCI artifacts
async function artifactChecker() {
  const TOKEN = process.env['BOT_TOKEN'];
  const CIRCLECI_TOKEN = process.env['CIRCLECI_TOKEN'];

  const issueNumber = '18700';
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


// Return true if the user is a member of bioconda
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


async function commentReposter(user, PR, s) {
  if(!await isBiocondaMember(user)) {
    console.log("Would repost for " + user);
    //await sendComment(PR, "Reposting to enable pings (courtesy of the BiocondaBot):\n" + s);
  } else {
    console.log("Would not repost for " + user);
  }
}


async function hasBeenMerged(PR) {
  const TOKEN = process.env['BOT_TOKEN'];
  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/pulls/" + PR + "/merge";
  let rv = 0;

  try {
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

  console.log("For PR " + PR + " the merged status is " + rv);
  if(rv == 204) {
    return(true);
  }
  return(false);
}


// Fetch and return the JSON of a PR
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

async function updateFromMaster(PR) {
  var PRInfo = await getPRInfo(PR); 
  // Remote branch
  var remoteBranch = PRInfo['head']['ref'];
  // Remote repo
  var remoteRepo = PRInfo['head']['repo']['full_name'];

  // Clone
  await exec.exec("git", ["clone", "git@github.com:" + remoteRepo + ".git"]);
  process.chdir('bioconda-recipes');

  // Add/pull upstream
  await exec.exec("git", ["remote", "add", "bhmaster", "https://github.com/bioconda/bioconda-recipes"]);
  await exec.exec("git", ["pull", "bhmaster", "master"]);

  // Merge it!
  if(remoteBranch != "master") {  // The pull will likely have failed already
    await exec.exec("git", ["checkout", remoteBranch]);
    await exec.exec("git", ["merge", "master"]);
  }

  // Push it
  await exec.exec("git", ["push"]);
}


// From stackoverflow: https://stackoverflow.com/a/37764963/4716976
function delay(ms) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}


async function isBiocondaMemberWrapper(x) {
  console.log(x['user']['login']);
  return await isBiocondaMember(x['user']['login']);
}


// Ensure there's at least one approval by a member
async function approvalReview(issueNumber) {
  const TOKEN = process.env['BOT_TOKEN'];
  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/pulls/" + issueNumber + "/reviews";
  var reviews = {};
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
  await exec.exec("bash", [installerLocation, "-b", "-p", home.concat("/miniconda")]);

  // Step 2: Create env with bioconda-utils
  await exec.exec("/home/runner/miniconda/bin/conda", ["create", "-n", "bioconda", "bioconda-utils", "anaconda-client"]);
}


async function downloadAndUpload(x) {
  const QUAY_TOKEN = process.env['QUAY_OAUTH_TOKEN'];
  const ANACONDA_TOKEN = process.env['ANACONDA_TOKEN'];
  const loc = await tc.downloadTool(x);
  console.log(x + " is named " + loc);

  // Rename
  const options = {force: true};
  await io.mv(loc, "." + x.split("/").pop());

  if(x.endsWith(".gz")) { // Container
    console.log("uploading container");
    //await exec.exec("/home/runner/miniconda/envs/bioconda/bin/mulled-build", ["push", loc, "-n", "biocontainers", "--oauth-token", QUAY_TOKEN]);
  } else if(x.endsWith(".bz2")) { // Package
    console.log("uploading package");
    //await exec.exec("/home/runner/miniconda/envs/bioconda/bin/anaconda", ["-t", ANACONDA_TOKEN, "upload", loc]);
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


// Upload artifacts to quay.io and anaconda
// Only call this for mergeable PRs!
async function uploadArtifacts(PR) {
  // Send a comment about "I will upload the artifacts and then merge!"

  // Get last sha
  var PRInfo = await getPRInfo(PR);
  var sha = PRInfo['head']['sha'];

  // Fetch the artifacts
  var artifacts = await fetchPRShaArtifacts(PR, sha);
  artifacts = artifacts.filter(x => x.endsWith(".gz") || x.endsWith(".bz2"));
  console.log(artifacts);
  assert(artifacts.length > 0);


  // Install bioconda-utils
  //await installBiocondaUtils();

  // Download/upload Artifacts
  await asyncForEach(artifacts, downloadAndUpload);

  // Hit merge
  // Message github on error
}


async function runner() {
  //await artifactChecker();
  //await commentReposter('dpryan79', 18794, "some text");
  //await commentReposter('Juke34', 18794, "some text");
  //await hasBeenMerged(18829);
  //await hasBeenMerged(18811);
  //await updateFromMaster(); // This should be in a try/catch
  //console.log("status of 18875: " + await checkIsMergeable(18875));
  //console.log("status of 18871: " + await checkIsMergeable(18871));
  //console.log("status of 18815: " + await checkIsMergeable(18815));
  //await uploadArtifacts(18815);
}

test('test artifacts', runner);
