// Copyright (c) Bloomberg Finance LP.
// Distributed under the terms of the Modified BSD License.

const playwright = require('playwright');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const semver = require('semver');
const {
  getConfig,
  log,
  saveLogsToFile,
  saveSessionInfo,
  waitForDuration
} = require('./util');

const config = getConfig();
const browserType = config.browserType;
const pwBrowser =
  browserType === 'firefox'
    ? playwright.firefox
    : browserType === 'webkit'
    ? playwright.webkit
    : playwright.chromium;

function getBuildJlabVersion() {
  const metadataFilePath = path.resolve(__dirname, './bin/metadata.json');
  let metadata = {};
  if (fs.existsSync(metadataFilePath)) {
    try {
      metadata = fs.readJSONSync(metadataFilePath);
    } catch (reason) {
      console.error(reason);
    }
  }

  const version = metadata['jlabVersion'];

  if (semver.valid(version)) {
    log('info', `Using Galata built for JupyterLab version ${version}`, {
      save: false
    });
  } else {
    log('error', 'Failed to detect build-time JupyterLab version');
  }
  return version;
}

async function logAndExit(type, message, code = 1) {
  log(type, message);
  saveLogsToFile('jest-logs.json');

  // wait for stdio to flush so that logs are visible on console
  await waitForDuration(1000);

  process.exit(code);
}

module.exports = async function () {
  // add a line break for first log to appear in new line
  console.log('\n');

  const pageWidth = config.pageWidth;
  const pageHeight = config.pageHeight;
  const headless = config.headless;
  const slowMo = config.slowMo;
  let browser;
  let wsEndpoint;

  if (config.browserUrl !== '') {
    try {
      const apiUrl = `${config.browserUrl}/json/version`;
      const response = await axios.get(apiUrl);
      wsEndpoint = response.data.webSocketDebuggerUrl;
      if (browserType === 'chromium') {
        browser = await pwBrowser.connectOverCDP({
          endpointURL: wsEndpoint,
          slowMo: slowMo
        });
      } else {
        browser = await pwBrowser.connect({
          wsEndpoint: wsEndpoint,
          slowMo: slowMo
        });
      }
    } catch (reason) {
      await logAndExit(
        'error',
        `Failed to connect to remote browser at "${config.browserUrl}"`
      );
    }
  } else {
    try {
      let executablePath = undefined;
      if (config.browserPath !== '') {
        if (fs.existsSync(config.browserPath)) {
          executablePath = config.browserPath;
        } else {
          log(
            'warning',
            `Browser executable not found at path ${config.browserPath}`
          );
        }
      }
      browser = await pwBrowser.launchServer({
        headless: headless,
        executablePath: executablePath,
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: {
          width: pageWidth,
          height: pageHeight,
          deviceScaleFactor: 1
        },
        slowMo: slowMo
      });
      wsEndpoint = browser.wsEndpoint();
    } catch (reason) {
      await logAndExit(
        'error',
        `Failed to launch headless browser "${config.browserType}" with path "${config.browserPath}"`
      );
    }
  }

  // store the browser instance so we can teardown it later
  // this global is only available in the teardown but not in TestEnvironments
  global.__BROWSER_GLOBAL__ = browser;

  const sessionInfo = {
    testId: config.testId,
    browserType: config.browserType,
    browserUrl: config.browserUrl,
    testOutputDir: config.testOutputDir,
    referenceDir: config.referenceDir,
    jlabBaseUrl: config.jlabBaseUrl,
    jlabToken: config.jlabToken,
    generateWorkspace: config.generateWorkspace,
    skipVisualRegression: config.skipVisualRegression === true,
    skipHtmlRegression: config.skipHtmlRegression === true,
    discardMatchedCaptures: config.discardMatchedCaptures !== false,
    wsEndpoint: wsEndpoint,
    buildJlabVersion: getBuildJlabVersion(),
    imageMatchThreshold: config.imageMatchThreshold
  };

  saveSessionInfo(sessionInfo);
};
