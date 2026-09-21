# SUFE Course Selection Executor (dev)

A local course-selection workflow automation project for Shanghai University of Finance and Economics (SUFE) EAMS, built with TypeScript and Playwright.

> **Note:** The program follows the normal interaction flow of the university website. It focuses on reliable workflow execution, correct state verification, and easy troubleshooting. The project does not include or provide any school account, password, Cookie, Session, Token, CAPTCHA, authentication, access-control, eligibility, or rate-limit bypass functionality.

## 🚀 Quick Start

### 📥 Download and install

**Windows users (recommended):**

- Download `SUFE-Course-Executor-v1.0.2-Windows-x64-portable.zip` from [Releases](https://github.com/Asternux/SUFE_FukManual/releases/latest).
- Extract the archive completely to a fixed folder. The portable package includes a Node.js runtime.
- Google Chrome or Microsoft Edge must still be installed on the computer.

**From source** (requires Node.js 20+):

```powershell
pnpm install --frozen-lockfile
pnpm build
Copy-Item config/courses.example.json config/courses.json
```

### 📖 Usage steps for Windows beginners

| Step | Action | Description |
|------|--------|-------------|
| 1 | Extract the ZIP completely to a fixed folder | Do not place it in a temporary folder |
| 2 | Double-click `0_打开使用说明.cmd` | Read the offline usage instructions |
| 3 | Double-click `1_首次环境检查.cmd` | Verify the system environment |
| 4 | Double-click `2_填写课程.cmd` | Configure target courses |
| 5 | Double-click `3_只读检查.cmd` | Validate the configuration without submitting |
| 6 | Double-click `4_实战运行.cmd` | Perform the actual course-selection operation |
| 7 | Double-click `5_查看最近结果.cmd` | View the latest results |

**Important:**

- `3_只读检查` only reads page state and does not submit anything.
- `4_实战运行` may perform real course-selection operations.
- The daily configuration defaults to `submission.enabled=false`.
- The practical-run entry point creates a one-time enabled configuration and removes it when finished.
- Practical-run confirmation first requires `RUN`; after `READY` is reached, enter the exact uppercase phrase `ARM`. Confirmation is case-sensitive.

## ✨ Features

- Configure multiple target classes through JSON or an interactive wizard.
- Support Chrome and Microsoft Edge, with the user completing the normal web login.
- Automatically resolve classes and stop when multiple candidates create ambiguity.
- Run independent workers for different courses while ensuring that each class has at most one in-flight submission.
- Separate submission from verification; success is reported only when the final selected state is unambiguous.
- Verify after network errors or unknown results, then perform bounded retries according to policy.
- Pause new submissions when login expires and resume state reading after login is restored.
- Provide per-course logs, run summaries, environment checks, and redacted diagnostic exports.

## 🔧 Configuration

`entryUrl` must be the complete course-selection entry URL for the current round and must contain the actual `electionProfile.id`. Target matching is performed in this order:

1. `lessonId`
2. `lessonNo` (class number/course sequence number)
3. `courseCode + teacher`
4. `name + teacher + time`

If multiple classes match, the program lists the candidates and stops until the ambiguity is resolved.

`priority` controls scheduling priority: smaller numbers have higher priority. It does not mean that one course must finish before another starts. Different courses are handled by independent workers and can proceed in parallel when no ordering is required.

For the first real run, setting `retry.maxAttempts` to `1` is recommended. The program enforces a minimum retry interval of 15 seconds and verifies the final state after every submission.

## 📋 Operation modes

### Inspect (read-only verification)

```powershell
pnpm start -- --config config/courses.json --mode inspect
```

Inspect opens the browser and waits for a normal login. It then checks class matching, enrollment capacity, selected status, time conflicts, and page operation status. After outputting `READY`, it exits and automatically closes the browser created by the program.

### Run (real operation)

```powershell
pnpm start -- --config config/courses.json --mode run
```

Real operation requires `submission.enabled=true` in the local configuration. When `requireArmPhrase=true`, the terminal also requires the exact uppercase phrase `ARM`. During execution, `status`, `pause`, `resume`, and `stop` commands are supported.

If course selection has not opened, workers normally remain in `PENDING` and wait for the page to become available. Courses that are not completed when `scheduler.maxRunDurationMs` is reached are stopped. The browser, terminal, network, and computer must remain available during execution.

## 🖥️ System requirements

| Platform | Status | Description |
|----------|--------|-------------|
| Windows 10/11 x64 | Officially supported | Tested on physical machines and with the independently extracted delivery package |
| macOS/Linux | Source testing | The Windows `.cmd` delivery layer cannot be used directly |

The source environment requires Node.js 20+, pnpm 11 (v1.0.2 was built with pnpm 11.19.0), and Chrome or Edge. Source mode uses the system browser and normally does not require `playwright install`; configure `browser.channel` according to the browser installed locally.

## 🔒 Security design

| Principle | Description |
|-----------|-------------|
| Do not trust a single signal | HTTP 200, a button click, a popup, or a completed request does not equal success |
| Final verification | The Verifier rereads the system's final selected state |
| Respect rate limits | Retry counts and wait times are bounded, and the server's `Retry-After` is honored |
| Single workflow | Only one submission for a given class may be in flight at a time |
| No bypasses | No CAPTCHA, authentication, access-control, or eligibility-check bypass is provided |
| No abuse | No high-frequency enrollment-count polling, extreme request rates, or request flooding is provided |

Logs are stored locally in `logs/`. Do not publish `logs/`, `config/courses.json`, `.runtime/`, browser profiles, or saved webpage files.

## 📚 Documentation

- [System and program architecture](docs/ARCHITECTURE.md)
- [Validation scope and known limitations](docs/VALIDATION.md)
- [v1.0.2 release notes](docs/RELEASE.md)
- [Windows delivery-layer maintenance notes](delivery/维护者说明.md)

## ⚖️ Terms of use

This project is intended only for learning and personal automation research. Follow the university's course-selection rules, network-service terms, and applicable laws and regulations. The project does not guarantee a place in any course and does not encourage high-frequency requests, unlimited retries, or interference with the normal operation of the university service.

## 📄 License

[MIT](LICENSE)

---

**Last updated:** v1.0.2 · **Report an issue:** [Issues](https://github.com/Asternux/SUFE_FukManual/issues)
