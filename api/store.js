// Since this is always included implicitly by Lambda, we include it as a devDependency in order to
// avoid the unnessary bloating of the .zip bundle.
const AWS = require('aws-sdk');

const url = require('url');

const {
    bucket,
    debug,
    short_domain: shortDomain,
} = require('../config.json');

const S3 = new AWS.S3();

const debugLog = (...args) => {
    // This will output to the CloudWatch log group for this lambda function
    if (debug) {
        console.log(...args);
    }
};

class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

async function validate(longUrl) {
    let parsed;
    debugLog(`validating longUrl ${longUrl}`);
    try {
        parsed = url.parse(longUrl);
    } catch (ex) {
        throw new HttpError(400, 'Not a valid URL');
    }
    const { host, path } = parsed;
    if (path.charAt(0) !== '/') {
        // Disallow anything with a doctored path
        throw new HttpError(400, 'Not a valid URL for shortening');
    }
    return longUrl;
}

async function createS3Object({ longUrl, slug }) {
    debugLog(`createS3Object ${slug} => ${longUrl}`);
    await S3.putObject({ Bucket: bucket, Key: slug, WebsiteRedirectLocation: longUrl }).promise();
    return;
}

function buildResponse(statusCode, { message, slug }) {
    const body = { message, slug };
    console.log(slug);

    if (slug) {
        body.url = `${shortDomain}/${slug}`;
    }
    debugLog(`buildResponse() code=${statusCode} body.url=${body.url}`);

    return {
        headers: { 'Access-Control-Allow-Origin': '*' },
        statusCode,
        body: JSON.stringify(body),
    };
}

function handleError(err = {}) {
    const code = err.statusCode || 500;
    const message = err.message || err.stack || String(err);
    debugLog(`handleError code=${code} message=${message}`);
    return buildResponse(code, { message });
}

module.exports.handle = ({ body }, context, callback) => {
    function sendResponse(response) {
        callback(null, response);
    }

    let parsedBody;
    try {
        console.log(body);
        parsedBody = JSON.parse(body);
    } catch (ex) {
        sendResponse(buildResponse(400, { message: 'Event doesn\'t contain a parsable JSON body' }));
        return;
    }
    const { url: longUrl, slug } = parsedBody;
    if (!longUrl || !slug) {
        sendResponse(buildResponse(400, { message: 'Event body must contain a `url` and `slug`' }));
        return;
    }

    validate(longUrl)
        .then(createS3Object({ longUrl, slug }))
        .then(sendResponse(buildResponse(200, { message: 'OK', slug })))
        .catch(err => sendResponse(handleError(err)));
};
