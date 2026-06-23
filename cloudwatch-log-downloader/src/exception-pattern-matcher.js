function normalizePatterns(patterns) {
    if (!Array.isArray(patterns)) {
        return [];
    }

    return patterns.filter(pattern =>
        typeof pattern === 'string' && pattern.length > 0
    );
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
            .some(pattern => text.includes(pattern));

        if (!matchesException) {
            return false;
        }

        return !excludes.some(pattern => text.includes(pattern));
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
