"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const core = require('@actions/core');
const exec = require('@actions/exec');
// const tc = require('@actions/tool-cache');
// const io = require('@actions/io');
// const fs = require('fs');
// This requires that a JOB_CONTEXT environment variable is made with `toJson(github)`
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('running env');
        let myOutput = '';
        let myError = '';
        const options = { listeners: {
                stdout: (data) => {
                    myOutput += data.toString();
                },
                stderr: (data) => {
                    myError += data.toString();
                }
            } };
        //await exec.exec('env', options);
        console.log('fetching GITHUB_SHA');
        console.log(process.env);
        console.log("stdout: " + myOutput);
        console.log("stderr: " + myError);
        //const jobContext = JSON.parse(core.getInput('JOB_CONTEXT'));
        //console.log(jobContext);
    });
}
function runRunner() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield run();
        }
        catch (e) {
            console.log("got an error");
            console.log(e);
            process.exit(1);
        }
    });
}
runRunner();
console.log('finished');
process.exit(1);
