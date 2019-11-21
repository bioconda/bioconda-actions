const core = require('@actions/core');
const exec = require('@actions/exec');
const request = require('request-promise-native');
const req = require('request');


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
  await req.get({
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


async function commentReposter(user, PR, s) {
  if(!await isBiocondaMember(user)) {
    console.log("Would repost for " + user);
    //await sendComment(PR, "Reposting to enable pings (courtesy of the BiocondaBot):\n" + s);
  } else {
    console.log("Would not repost for " + user);
  }
}


async function runner() {
  //await artifactChecker();
  await commentReposter('dpryan79', 18794, "some text");
  await commentReposter('Juke34', 18794, "some text");
}

test('test artifacts', runner);
