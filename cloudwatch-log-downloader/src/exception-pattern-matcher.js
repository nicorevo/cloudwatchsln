function normalizePatterns(patterns) {
    if (!Array.isArray(patterns)) {
        return [];
    }

    return patterns.filter(pattern =>
        typeof pattern === 'string' && pattern.length > 0
    );
}

function matchesPattern(text, pattern) {
    if (pattern.toLowerCase() === 'error') {
        return new RegExp(`(^|[^A-Za-z])${pattern}($|[^A-Za-z])`).test(text);
    }

    return text.includes(pattern);
}

function createExceptionMatcher(
    exceptionPatterns,
    excludeExceptionPatterns = [],
    options = {}
) {
    if (options.matchWhenUnconfigured && !Array.isArray(exceptionPatterns)) {
        return () => true;
    }

    const includes = normalizePatterns(exceptionPatterns);
    const excludes = normalizePatterns(excludeExceptionPatterns);

    return message => {
        const text = message ?? '';
        const matchesException = includes
            .some(pattern => matchesPattern(text, pattern));

        if (!matchesException) {
            return false;
        }

        return !excludes.some(pattern => matchesPattern(text, pattern));
    };
}

function isExceptionMessage(
    message,
    exceptionPatterns = [],
    excludeExceptionPatterns = []
) {
    return createExceptionMatcher(
        exceptionPatterns,
        excludeExceptionPatterns
    )(message);
}

module.exports = {
    normalizePatterns,
    createExceptionMatcher,
    isExceptionMessage
};
