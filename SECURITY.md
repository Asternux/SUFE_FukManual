# Security and privacy

Please do not post any of the following in public issues, discussions, pull requests, or other public channels:

- Passwords, verification codes, complete Cookies, Session IDs, Authorization headers, Tokens, or Tickets;
- Student IDs, names, phone numbers, browser login directories, real course configurations, or unredacted diagnostic logs;
- Any other information that could identify an account, reveal credentials, or expose private enrollment data.

If logs are needed to investigate a problem, first use `8_导出诊断包.cmd` from the release package. Before sharing the exported package, inspect it again and check course names, `lessonId`, run times, status values, account-related information, and any other potentially sensitive content. Redact or remove anything that could expose an identity or credential.

The project does not intentionally record request headers, Cookies, Tokens, or network response bodies. Any request to bypass authentication, CAPTCHA, access controls, eligibility checks, or rate limits is outside the scope of this project and will not be supported.

For private vulnerability reports, please use GitHub's private security reporting features when available instead of opening a public issue. If private reporting is unavailable, contact the repository maintainer before disclosing sensitive details publicly.
