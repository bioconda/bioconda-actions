const core = require('@actions/core');
const exec = require('@actions/exec');
const request = require('request-promise-native');
const req = require('request');


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
  let rc = 0;

  const URL = "https://circleci.com/api/v1.1/project/github/bioconda/bioconda-recipes/" + ID + "/artifacts";
  console.log("contacting circleci " + URL);
  await req.get({
    'url': URL,
    }, function(e, r, b) {
      rc += r.responseCode;
       console.log("internally circleci returned " + b);
      res += b });
  console.log("return code is " + rc + " with content " + res + " of length " + res.length);

  // Sometimes we get a 301 error, so there are no longer artifacts available
  if(rc == 301 || res.length == 0) {
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
  console.log("Final artifact URLs: " + artifacts + "The length is " + artifacts.length);
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
    //await sendComment(PR, "No artifacts found on the most recent CircleCI build. Either the build failed or the recipe was blacklisted/skipped. -The Bot");
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


// This is currently non-functional
function mergeInMaster(context) {
  const TOKEN = process.env['BOT_TOKEN'];

  let branch = '';
  const options = {listeners: {
    stdout: (data: Buffer) => {
      branch += data.toString();
    },
  }};
  exec.exec('git branch | grep \*', options);
  console.log('The branch is ' + branch.split(" ")[1]);
  exec.exec('git', ['remote', 'add', 'upstream', 'https://github.com/bioconda/bioconda-recipes']);
  exec.exec('git', ['checkout', 'master']);
  exec.exec('git', ['pull', 'upstream', 'master']);
  exec.exec('git', ['checkout', branch]);
  exec.exec('git', ['merge', 'master']);

  console.log('Going to push');
  exec.exec('git', ['push']);
  console.log('I pushed!');

  const issueNumber = context['event']['issue']['number'];
  sendComment(issueNumber, "OMFG it worked!");
}

// This requires that a JOB_CONTEXT environment variable, which is made with `toJson(github)`
async function run() {
  const jobContext = JSON.parse(<string> process.env['JOB_CONTEXT']);
  console.log(jobContext);
  if(jobContext['event']['issue']['pull_request'] !== undefined) {
    console.log('The actor is ' + jobContext['actor']);
    if(jobContext['actor'] != 'dpryan79') {
      console.log('skipping');
      process.exit(0);
    }

    const issueNumber = jobContext['event']['issue']['number'];

    console.log('The comment is ' + jobContext['event']['comment']);
    const comment = <string> jobContext['event']['comment']['body'];
    console.log('the comment is: ' + comment);

    if(comment.startsWith('@bioconda-bot')) {
      console.log("We should send a comment");
      // Cases are:
      //   please update
      //   please merge
      if(comment.includes('please update')) {
        mergeInMaster(jobContext);
      } else if(comment.includes(' hello')) {
        await sendComment(issueNumber, "Is it me you're looking for?\n> I can see it in your eyes.");
      } else if(comment.includes(' please fetch artifacts') || comment.includes(' please fetch artefacts')) {
        await artifactChecker(issueNumber);
        process.exit(1);
      }
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
