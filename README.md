This contains subdirectory with github actions used by the bioconda project.

Current subdirectories:

 - `bioconda_utils_autobump`: Used by the bioconda-utils repository to test autobump
 - `bioconda_utils_setup_conda`: Used by almost all bioconda repositories. This sets up bioconda-utils.

# Modifying this repository

To modify this repository you first need a repository with nodejs installed:

    conda create -n nodejs nodejs
    conda activate nodejs

You will then need to install all dependencies needed by the subdirectories:

    npm install

And then change into the directory you want to modify. The source code for each test can be found in `src/main.ts`. This MUST be built before it can be used:

    npm run build

If you commit and push those results the test will then be live.
