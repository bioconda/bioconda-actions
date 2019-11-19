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
// const exec = require('@actions/exec');
// const tc = require('@actions/tool-cache');
// const io = require('@actions/io');
// const fs = require('fs');
// This requires that a JOB_CONTEXT environment variable is made with `toJson(github)`
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        const foo = JSON.parse(core.getInput('GITHUB_SHA'));
        console.log(foo);
        const jobContext = JSON.parse(core.getInput('JOB_CONTEXT', { required: true }));
        console.log(jobContext);
    });
}
function runRunner() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield run();
        }
        catch (e) {
            console.log(e);
            process.exit(1);
        }
    });
}
runRunner();
