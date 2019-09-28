const pr = require('process');
const exec = require('@actions/exec');
const io = require('@actions/io');

async function run() {
  await io.rmRF("bioconda-recipes");
  // Circleci has ssh keys configured!
  //await exec.exec("git", ["clone", "git@github.com:bioconda/bioconda-recipes"]);
  await exec.exec("git", ["clone", "https://github.com/bioconda/bioconda-recipes"]);
  await pr.chdir("bioconda-recipes");
  await exec.exec("git", ["config", "user.name", "Autobump"]);
  await exec.exec("git", ["config", "user.email", "bioconda@users.noreply.github.com"]);
  await io.mkdirP("/tmp/artifacts");
  await exec.exec("bioconda-utils", ["autobump", "--unparsed-urls", "/tmp/artifacts/unparsed_urls.txt", 
                                     "--failed-urls", "/tmp/artifacts/failed_urls.txt",
                                     "--recipe-status", "/tmp/artifacts/status.txt",
                                     "--create-pr",
                                     "--no-check-pinnings",
                                     "--no-check-pending-deps",
                                     "--no-follow-graph",
                                     "--exclude", "bioconductor-*",
                                     "--commit-as", "BiocondaBot", "47040946+BiocondaBot@users.noreply.github.com",
                                     process.env.AUTOBUMP_OPTS]);
}

try {
  run();
}
catch(e) {
  console.log(e);
  process.exit(1);
};
