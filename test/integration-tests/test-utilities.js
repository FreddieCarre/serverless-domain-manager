"use strict";

const request = require("request-promise-native");
const aws = require("aws-sdk");
const dns = require("dns");
const shell = require("shelljs");
const util = require('util');

const AWS_PROFILE = process.env.AWS_PROFILE;
const apiGateway = new aws.APIGateway({
  region: "us-west-2",
  credentials: new aws.SharedIniFileCredentials(
    { profile: AWS_PROFILE },
  ),
});

class CreationError extends Error {}


/**
 * Stops event thread execution for given number of seconds.
 * @param seconds
 * @returns {Promise<any>} Resolves after given number of seconds.
 */
function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, 1000 * seconds));
}

/**
 * Executes given shell command.
 * @param cmd shell command to execute
 * @returns {Promise<boolean>} Resolves true if successfully executed, else false
 */
async function exec(cmd) {
  return new Promise((resolve) => {
    shell.exec(`${cmd}`, { silent: false }, (err, stdout, stderr) => {
      if (err || stderr) {
        return resolve(false);
      }
      return resolve(true);
    });
  });
}

/**
 * Move item in folderName to created tempDir
 * @param {string} tempDir
 * @param {string} folderName
 */
async function createTempDir(tempDir, folderName) {
  await exec(`rm -rf ${tempDir}`);
  await exec(`mkdir -p ${tempDir} && cp -R test/integration-tests/${folderName}/. ${tempDir}`);
  await exec(`mkdir -p ${tempDir}/node_modules`);
  await exec(`ln -s $(pwd) ${tempDir}/node_modules/`);
}

/**
 * Links current serverless-domain-manager to global node_modules in order to run tests.
 * @returns {Promise<boolean>} Resolves true if successfully linked, else false.
 */
async function linkPackages() {
  return new Promise((resolve) => {
    shell.exec("npm link serverless-domain-manager", { silent: false }, (err, stdout, stderr) => {
      if (err || stderr) {
        return resolve(false);
      }
      return resolve(true);
    });
  });
}

/**
 * Gets endpoint type of given URL from AWS
 * @param url
 * @returns {Promise<String|null>} Resolves to String if endpoint exists, else null.
 */
async function getEndpointType(url) {
  const params = {
    domainName: url,
  };
  try {
    const result = await apiGateway.getDomainName(params).promise();
    return result.endpointConfiguration.types[0];
  } catch (err) {
    return null;
  }
}

/**
 * Gets stage of given URL from AWS
 * @param url
 * @returns {Promise<String|null>} Resolves to String if stage exists, else null.
 */
async function getStage(url) {
  const params = {
    domainName: url,
  };
  try {
    const result = await apiGateway.getBasePathMappings(params).promise();
    return result.items[0].stage;
  } catch (err) {
    return null;
  }
}

/**
 * Gets basePath of given URL from AWS
 * @param url
 * @returns {Promise<String|null>} Resolves to String if basePath exists, else null.
 */
async function getBasePath(url) {
  const params = {
    domainName: url,
  };
  try {
    const result = await apiGateway.getBasePathMappings(params).promise();
    return result.items[0].basePath;
  } catch (err) {
    return null;
  }
}

/**
 * Make API Gateway calls to create an API Gateway
 * @param {string} randString
 * @return {Object} Contains restApiId and resourceId
 */
async function setupApiGatewayResources(randString) {
  const restApiInfo = await apiGateway.createRestApi({ name: `rest-api-${randString}` }).promise();
  const restApiId = restApiInfo.id;
  const resourceInfo = await apiGateway.getResources({ restApiId }).promise();
  const resourceId = resourceInfo.items[0].id;
  shell.env.REST_API_ID = restApiId;
  shell.env.RESOURCE_ID = resourceId;
  return { restApiId, resourceId };
}

/**
 * Make API Gateway calls to delete an API Gateway
 * @param {string} restApiId
 * @return {boolean} Returns true if deleted
 */
async function deleteApiGatewayResources(restApiId) {
  return apiGateway.deleteRestApi({ restApiId }).promise();
}

/**
 * Runs `sls create_domain` for the given folder
 * @param tempDir
 * @param domainIdentifier Random alphanumeric string to identify specific run of integration tests.
 * @returns {Promise<any>}
 */
function slsCreateDomain(tempDir, domainIdentifier) {
  return new Promise((resolve) => {
    shell.exec(`cd ${tempDir} && serverless create_domain --RANDOM_STRING ${domainIdentifier}`, { silent: false }, (err, stdout, stderr) => {
      if (err || stderr) {
        return resolve(false);
      }
      return resolve(true);
    });
  });
}

/**
 * Runs `sls deploy` for the given folder
 * @param tempDir
 * @param domainIdentifier Random alphanumeric string to identify specific run of integration tests.
 * @returns {Promise<any>}
 */
function slsDeploy(tempDir, domainIdentifier) {
  return new Promise((resolve) => {
    shell.exec(`cd ${tempDir} && serverless deploy --RANDOM_STRING ${domainIdentifier}`, { silent: false }, (err, stdout, stderr) => {
      if (err || stderr) {
        return resolve(false);
      }
      return resolve(true);
    });
  });
}

/**
 * Runs `sls delete_domain` for the given folder
 * @param tempDir
 * @param domainIdentifier Random alphanumeric string to identify specific run of integration tests.
 * @returns {Promise<any>}
 */
function slsDeleteDomain(tempDir, domainIdentifier) {
  return new Promise((resolve) => {
    shell.exec(`cd ${tempDir} && serverless delete_domain --RANDOM_STRING ${domainIdentifier}`, { silent: false }, (err, stdout, stderr) => {
      if (err || stderr) {
        return resolve(false);
      }
      return resolve(true);
    });
  });
}

/**
 * Runs `sls remove` for the given folder
 * @param tempDir
 * @param domainIdentifier Random alphanumeric string to identify specific run of integration tests.
 * @returns {Promise<any>}
 */
function slsRemove(tempDir, domainIdentifier) {
  return new Promise((resolve) => {
    shell.exec(`cd ${tempDir} && serverless remove --RANDOM_STRING ${domainIdentifier}`, { silent: false }, (err, stdout, stderr) => {
      if (err || stderr) {
        return resolve(false);
      }
      return resolve(true);
    });
  });
}

/**
 * Runs both `sls create_domain` and `sls deploy`
 * @param tempDir
 * @param domainIdentifier Random alphanumeric string to identify specific run of integration tests.
 * @returns {Promise<*>}
 */
async function deployLambdas(tempDir, domainIdentifier) {
  const created = await slsCreateDomain(tempDir, domainIdentifier);
  const deployed = await slsDeploy(tempDir, domainIdentifier);
  return created && deployed;
}

/**
 * Runs both `sls delete_domain` and `sls remove`
 * @param tempDir temp directory where code is being run from
 * @param domainIdentifier Random alphanumeric string to identify specific run of integration tests.
 * @returns {Promise<*>}
 */
async function removeLambdas(tempDir, domainIdentifier) {
  const removed = await slsRemove(tempDir, domainIdentifier);
  const deleted = await slsDeleteDomain(tempDir, domainIdentifier);
  return deleted && removed;
}

/**
 * Wraps creation of testing resources.
 * @param folderName
 * @param url
 * @param domainIdentifier Random alphanumeric string to identify specific run of integration tests.
 * @param enabled
 * @returns {Promise<boolean>} Resolves true if resources created, else false.
 */
async function createResources(folderName, url, domainIdentifier, enabled) {
  console.debug(`\tCreating Resources for ${url}`); // eslint-disable-line no-console
  const tempDir = `~/tmp/domain-manager-test-${domainIdentifier}`;
  console.debug(`\tUsing tmp directory ${tempDir}`);
  await createTempDir(tempDir, folderName); // eslint-disable-line no-console
  const created = await deployLambdas(tempDir, domainIdentifier);
  if (created) {
    console.debug("\tResources Created"); // eslint-disable-line no-console
  } else {
    console.debug("\tResources Failed to Create"); // eslint-disable-line no-console
  }
  return created;
}

/**
 * Wraps deletion of testing resources.
 * @param url
 * @param domainIdentifier Random alphanumeric string to identify specific run of integration tests.
 * @returns {Promise<boolean>} Resolves true if resources destroyed, else false.
 */
async function destroyResources(url, domainIdentifier) {
  console.debug(`\tCleaning Up Resources for ${url}`); // eslint-disable-line no-console
  const tempDir = `~/tmp/domain-manager-test-${domainIdentifier}`;
  const removed = await removeLambdas(tempDir, domainIdentifier);
  await exec(`rm -rf ${tempDir}`);
  if (removed) {
    console.debug("\tResources Cleaned Up"); // eslint-disable-line no-console
  } else {
    console.debug("\tFailed to Clean Up Resources"); // eslint-disable-line no-console
  }
  return removed;
}

module.exports = {
  createResources,
  createTempDir,
  destroyResources,
  exec,
  slsCreateDomain,
  slsDeploy,
  slsDeleteDomain,
  slsRemove,
  deployLambdas,
  removeLambdas,
  getEndpointType,
  getBasePath,
  getStage,
  linkPackages,
  sleep,
  CreationError,
  setupApiGatewayResources,
  deleteApiGatewayResources,
};
