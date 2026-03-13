export const DEFAULT_CONTINUATION_PROMPT_TEMPLATE = `Continue working only if you find a genuinely substantial reason to make another change: a bug fix, a missed edge case, an important correctness, reliability, or security issue, or a meaningful improvement to performance, UX, the structure of the solution, or the plan.

Do not continue for cosmetic churn. Do not rewrite text, comments, naming, formatting, tiny refactors, small cleanup, micro-optimizations, or other insignificant improvements.

If nothing truly important remains, do not change any files and reply briefly that no substantial changes are needed.

If an important improvement is needed, make only the substantial changes and then briefly explain what you changed and why.`;
