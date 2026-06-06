function httpError(statusCode, publicMessage, details) {
  const error = new Error(details || publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  return error;
}

module.exports = { httpError };
