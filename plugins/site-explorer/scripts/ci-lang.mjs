// Imported FIRST by ci-run.mjs: the language of the whole process (including the banner text that is compared against when the PR comment is built)
// must be fixed before any module that reads it is evaluated. Action input `lang` (INPUT_LANG): zh, anything else = English.
if (process.env.INPUT_LANG !== undefined) process.env.SITE_EXPLORER_LANG = /^zh/i.test(process.env.INPUT_LANG || '') ? 'zh' : 'en';
