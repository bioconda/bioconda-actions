"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const pr = require('process');
const exec = require('@actions/exec');
const io = require('@actions/io');
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        yield io.rmRF("bioconda-recipes");
        // Circleci has ssh keys configured!
        //await exec.exec("git", ["clone", "git@github.com:bioconda/bioconda-recipes"]);
        yield exec.exec("git", ["clone", "https://github.com/bioconda/bioconda-recipes"]);
        yield pr.chdir("bioconda-recipes");
        yield exec.exec("git", ["config", "user.name", "Autobump"]);
        yield exec.exec("git", ["config", "user.email", "bioconda@users.noreply.github.com"]);
        yield io.mkdirP("/tmp/artifacts");
        yield exec.exec("bioconda-utils", ["autobump", "--unparsed-urls", "/tmp/artifacts/unparsed_urls.txt",
            "--failed-urls", "/tmp/artifacts/failed_urls.txt",
            "--recipe-status", "/tmp/artifacts/status.txt",
            "--create-pr",
            "--no-check-pinnings",
            "--no-check-pending-deps",
            "--no-follow-graph",
            "--exclude", "bioconductor-*",
            "--commit-as", "BiocondaBot", "47040946+BiocondaBot@users.noreply.github.com",
            process.env.AUTOBUMP_OPTS]);
    });
}
try {
    run();
}
catch (e) {
    console.log(e);
    process.exit(1);
}
;
