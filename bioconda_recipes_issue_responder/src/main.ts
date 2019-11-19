const core = require('@actions/core');

// const exec = require('@actions/exec');
// const tc = require('@actions/tool-cache');
// const io = require('@actions/io');
// const fs = require('fs');

// This requires that a JOB_CONTEXT environment variable is made with `toJson(github)`
async function run() {
  const jobContext = JSON.parse(core.getInput('JOB_CONTEXT', { required: true}));
  console.log(jobContext);
}

try {
  run();
}
catch(e) {
  console.log(e);
  process.exit(1);
};
