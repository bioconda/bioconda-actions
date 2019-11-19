const core = require('@actions/core');
const exec = require('@actions/exec');
const request = require('request');
// const io = require('@actions/io');
// const fs = require('fs');

function sendComment(context, comment) {
  const issueNumber = context['issue']['number'];
  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/" + issueNumber + "/comments";
  const payLoad = {'body': comment};
  request.post(URL, {
    json: {
      body: comment
    }});
}

function mergeInMaster(context) {
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

  sendComment(context, "OMFG it worked!");
  // send comment
}

// This requires that a JOB_CONTEXT environment variable is made with `toJson(github)`
async function run() {
  const jobContext = JSON.parse(<string> process.env['JOB_CONTEXT']);
  if(jobContext['issue']['pull_request'] !== undefined) {
    console.log('The actor is ' + jobContext['actor']);
    if(jobContext['actor'] != 'dpryan79') {
      console.log('skipping');
      process.exit(0);
    }
    const comment = <string> jobContext['comment']['body'];
    console.log('the comment is: ' + comment);
    if(comment.includes('@bioconda-bot')) {
      // Cases are:
      //   please update
      //   please merge
      if(comment.includes('please update')) {
        mergeInMaster(jobContext);
      }
//      } else if comment.includes('please merge') {
//        mergePR(jobContext);
//      }
//    } else if commet.includes('@bioconda/') {
//      // Check if the user is part of bioconda, otherwise ping
//      pingBioconda(jobContext);
    }
    process.exit(0);
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
