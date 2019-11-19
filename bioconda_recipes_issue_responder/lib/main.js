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
const request = require('request');
// const io = require('@actions/io');
// const fs = require('fs');
function sendComment(context, comment) {
    const issueNumber = context['issue']['number'];
    const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/" + issueNumber + "/comments";
    const payLoad = { 'body': comment };
    request.post(URL, {
        json: {
            body: comment
        }
    });
}
function mergeInMaster(context) {
    let branch = '';
    const options = { listeners: {
            stdout: (data) => {
                branch += data.toString();
            },
        } };
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
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        const jobContext = JSON.parse(process.env['JOB_CONTEXT']);
        console.log(jobContext);
        if (jobContext['event']['issue']['pull_request'] !== undefined) {
            console.log('The actor is ' + jobContext['actor']);
            if (jobContext['actor'] != 'dpryan79') {
                console.log('skipping');
                process.exit(0);
            }
            console.log('The comment is ' + jobContext['event']['comment']);
            const comment = jobContext['event']['comment']['body'];
            console.log('the comment is: ' + comment);
            if (comment.includes('@bioconda-bot')) {
                // Cases are:
                //   please update
                //   please merge
                if (comment.includes('please update')) {
                    mergeInMaster(jobContext);
                }
            }
            process.exit(0);
        }
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
