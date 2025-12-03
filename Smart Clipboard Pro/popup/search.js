const WHITESPACE = /\s+/;

function normalize(text) {
    return (text || '').toString().toLowerCase();
}

function buildHaystack(item) {
    return normalize([item.text, item.title, item.keyword, item.type, item.tags?.join(' ')]
        .filter(Boolean)
        .join(' '));
}

function parseQuery(rawQuery) {
    const filters = {};
    const terms = [];

    (rawQuery || '')
        .trim()
        .split(WHITESPACE)
        .filter(Boolean)
        .forEach((token) => {
            if (token.includes(':')) {
                const [key, value] = token.split(':');
                if (key === 'type' && value) {
                    filters.type = value.toLowerCase();
                } else if (key === 'source' && value) {
                    filters.source = value.toLowerCase();
                } else {
                    terms.push(token);
                }
            } else {
                terms.push(token);
            }
        });

    return { filters, term: terms.join(' ').toLowerCase() };
}

function matchesFilters(item, filters) {
    if (filters.type && normalize(item.type) !== filters.type) {
        return false;
    }
    if (filters.source && normalize(item.source) !== filters.source) {
        return false;
    }
    return true;
}

function fuzzyScore(haystack, needle) {
    if (!needle) return 1;
    let score = 0;
    let lastIndex = -1;
    for (const char of needle) {
        const matchIndex = haystack.indexOf(char, lastIndex + 1);
        if (matchIndex === -1) {
            return 0;
        }
        score += matchIndex - lastIndex;
        lastIndex = matchIndex;
    }
    return 1 / score;
}

export function filterAndRank(items, query) {
    if (!query) return items;
    const parsed = parseQuery(query);
    const matches = [];

    items.forEach((item) => {
        if (!matchesFilters(item, parsed.filters)) {
            return;
        }
        const haystack = buildHaystack(item);
        const score = fuzzyScore(haystack, parsed.term);
        if (score > 0) {
            matches.push({ item, score });
        }
    });

    return matches
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item);
}
