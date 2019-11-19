const core = require('@actions/core');
// const exec = require('@actions/exec');
// const tc = require('@actions/tool-cache');
// const io = require('@actions/io');
// const fs = require('fs');

// This requires that a JOB_CONTEXT environment variable is made with `toJson(github)`
async function run() {
  console.log(process.env);
  //const jobContext = JSON.parse(process.env['JOB_CONTEXT']);
  //console.log(jobContext);
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
console.log('finished');
process.exit(1);
