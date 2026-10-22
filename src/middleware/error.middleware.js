module.exports = (err, req, res, next) => {

    console.log(err);

    let statusCode = err.statusCode || 500;
    let message = err.message || "Internal Server Error";

    // Mongoose CastError — malformed id / value passed for a typed field
    if (err.name === "CastError") {
        statusCode = 400;
        message = `Invalid ${err.path}: "${err.value}"`;
    }

    // Mongoose ValidationError — schema rule(s) failed
    if (err.name === "ValidationError") {
        statusCode = 400;
        message = Object.values(err.errors)
            .map((e) => e.message)
            .join(", ");
    }

    // Mongo duplicate key error
    if (err.code === 11000) {
        statusCode = 409;
        const field = Object.keys(err.keyValue || {})[0] || "field";
        const value = err.keyValue?.[field];
        message = `${field} "${value}" already exists`;
    }

    const response = {

        success: false,

        message

    };

    if (err.retryAfter) response.retryAfter = err.retryAfter;

    res.status(statusCode).json(response);

};
