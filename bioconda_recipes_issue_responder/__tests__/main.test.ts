const core = require('@actions/core');
const exec = require('@actions/exec');
const request = require('request');

function requestCallback(error, response, body) {
  if (error || (response.statusCode < 200 && response.statusCode > 202)) {
    process.exit(1)
  }
}

async function foo() {
  const TOKEN = process.env['BOT_TOKEN'];
  const issueNumber = process.env['ISSUE_NUMBER'];

  const URL = "https://api.github.com/repos/bioconda/bioconda-recipes/issues/" + issueNumber + "/comments";
  console.log("Sending request");
  await request.post({
    'url': URL,
    'headers': {'Authorization': 'token ' + TOKEN,
                'User-Agent': 'BiocondaCommentResponder'},
    'json': {
      body: "Is it me you're looking for? -Bot"
    }}, requestCallback);
  console.log("Request sent");
}

async function runner() {
  await foo();
}

test('test post', runner);
