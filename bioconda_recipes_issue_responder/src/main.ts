const core = require('@actions/core');
const exec = require('@actions/exec');
// const tc = require('@actions/tool-cache');
// const io = require('@actions/io');
// const fs = require('fs');

// This requires that a JOB_CONTEXT environment variable is made with `toJson(github)`
async function run() {
  console.log('running env');

  let myOutput = '';
  let myError = '';

  const options = {listeners: {
    stdout: (data: Buffer) => {
      myOutput += data.toString();
    },
    stderr: (data: Buffer) => {
      myError += data.toString();
    }
  }};
  await exec.exec('env', options);
  console.log('fetching GITHUB_SHA');
  const foo = core.getInput('GITHUB_SHA');
  console.log(foo);
  //const jobContext = JSON.parse(core.getInput('JOB_CONTEXT'));
  //console.log(jobContext);
}

async function runRunner() {
  try {
    await run();
  } catch(e) {
    console.log(e);
    process.exit(1);
  }
}

runRunner();
console.log('finished');
process.exit(1);
