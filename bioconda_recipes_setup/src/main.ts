const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const io = require('@actions/io');
const fs = require('fs');

function parseCommonSh(fname) {
  var lines = fs.readFileSync(fname, "UTF-8").split(/\r?\n/);

  var h = {};
  for(var i = 0; i < lines.length; i++) {
    var cols = lines[i].split("=");
    if(cols.length == 2) h[cols[0]] = cols[1];
  };
  return h;
}


// This should all be cached!
async function run() {
  // Download and parse common.sh
  const common_sh = await tc.downloadTool("https://raw.githubusercontent.com/bioconda/bioconda-common/master/common.sh");
  const envVars = parseCommonSh(common_sh);

  if(process.platform == "linux") {
    var tag = "Linux";
    var home = "/home/runner";
  } else {
    var tag = "MacOSX";
    var home = "/Users/runner";

    // We need to set CONDA_BUILD_SYSROOT on OSX
    //let CONDA_BUILD_SYSROOT = '';
    //var options = {};
    //options = { listeners: {
    //  stdout: (data: Buffer) => {
    //    CONDA_BUILD_SYSROOT += data.toString();
    //  }}
    //};
    //await exec.exec("xcode-select", ["-p"], options);
    //CONDA_BUILD_SYSROOT = CONDA_BUILD_SYSROOT.concat("/Platforms/MacOSX.platform/Developer/SDKs/MacOSX10.9.sdk");
    //core.exportVariable("CONDA_BUILD_SYSROOT", CONDA_BUILD_SYSROOT);
  }
  // Strip the v from the version
  envVars["MINICONDA_VER"] = envVars["MINICONDA_VER"].replace("v", "");
  var URL = "https://repo.continuum.io/miniconda/Miniconda3-" + envVars["MINICONDA_VER"] + "-" + tag + "-x86_64.sh";

  // Step 1: Download and install conda
  // Otherwise conda can't install for some reason
  await io.mkdirP(home.concat('/.conda'));
  const installerLocation = await tc.downloadTool(URL);
  await exec.exec("bash", [installerLocation, "-b", "-p", home.concat("/miniconda")]);

  // Step 2: Setup conda
  core.addPath(home.concat("/miniconda/bin"));
  await exec.exec(home.concat("/miniconda/bin/conda"), ["config", "--set", "always_yes", "yes"]);
  await exec.exec(home.concat("/miniconda/bin/conda"), ["config", "--system", "--add", "channels", "defaults"]);
  await exec.exec(home.concat("/miniconda/bin/conda"), ["config", "--system", "--add", "channels", "bioconda"]);
  await exec.exec(home.concat("/miniconda/bin/conda"), ["config", "--system", "--add", "channels", "conda-forge"]);


  // Step 3: Install bioconda-utils, which is currently the most recent version
  if(process.platform == "linux") {
    await exec.exec(home.concat("/miniconda/bin/conda"), ["install", "bioconda-utils=" + envVars["BIOCONDA_UTILS_TAG"]]);
  } else {
    await exec.exec(home.concat("/miniconda/bin/conda"), ["install", "bioconda-utils=" + envVars["BIOCONDA_UTILS_TAG"], "conda-forge-ci-setup"]);
  }
  core.addPath(home.concat("/miniconda/envs/bioconda/bin"));

  // step 4: cleanup
  await exec.exec(home.concat("/miniconda/bin/conda"), ["clean", "-y", "--all"]);

  // Add local channel as highest priority
  await io.mkdirP(home.concat("/miniconda/envs/bioconda/conda-bld/noarch"));
  await io.mkdirP(home.concat("/miniconda/envs/bioconda/conda-bld/linux-64"));
  await io.mkdirP(home.concat("/miniconda/envs/bioconda/conda-bld/osx-64"));
  await exec.exec(home.concat("/miniconda/bin/conda"), ["index", home.concat("/miniconda/envs/bioconda/conda-bld")]);
  await exec.exec(home.concat("/miniconda/bin/conda"), ["config", "--system", "--add", "channels", "file://" + home.concat("/miniconda/envs/bioconda/conda-bld")]);
}

try {
  run();
}
catch(e) {
  console.log(e);
  process.exit(1);
};
