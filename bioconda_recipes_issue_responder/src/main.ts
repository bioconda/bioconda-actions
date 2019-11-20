const core = require('@actions/core');
const exec = require('@actions/exec');
const request = require('request');
// const io = require('@actions/io');
// const fs = require('fs');

function requestCallback(error, response, body) {
  console.log("the response code was " + response.statusCode);
  if (!error && response.statusCode == 200) {
    const info = JSON.parse(body);
    console.log(info.stargazers_count + " Stars");
    console.log(info.forks_count + " Forks");
    process.exit(1)
  } else {
    console.log("the response code was " + response.statusCode);
  }
}

function sendComment(context, comment) {
  const TOKEN = process.env['BOT_TOKEN'];

  const issueNumber = context['event']['issue']['number'];
  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/" + issueNumber + "/comments";
  const payLoad = {'body': comment};
  console.log("Sending request");
  request.post({
    'url': URL,
    'json': {
      body: comment
    }}, requestCallback).auth(null, null, true, TOKEN);
  console.log("Request sent");
}

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

  sendComment(context, "OMFG it worked!");
  // send comment
}

// This requires that a JOB_CONTEXT environment variable is made with `toJson(github)`
async function run() {
  const jobContext = JSON.parse(<string> process.env['JOB_CONTEXT']);
  console.log(jobContext);
  if(jobContext['event']['issue']['pull_request'] !== undefined) {
    console.log('The actor is ' + jobContext['actor']);
    if(jobContext['actor'] != 'dpryan79') {
      console.log('skipping');
      process.exit(0);
    }
    console.log('The comment is ' + jobContext['event']['comment']);
    const comment = <string> jobContext['event']['comment']['body'];
    console.log('the comment is: ' + comment);
    if(comment.includes('@bioconda-bot')) {
      console.log("We should send a comment");
      // Cases are:
      //   please update
      //   please merge
      if(comment.includes('please update')) {
        mergeInMaster(jobContext);
      } else if(comment.includes(' hello')) {
        sendComment(jobContext, "Is it me you're looking for?");
      }
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
