# md2pdf

[![CI](https://github.com/t2o0n321/md2pdf/actions/workflows/ci.yml/badge.svg)](https://github.com/t2o0n321/md2pdf/actions/workflows/ci.yml)

把 Markdown 轉成 PDF，**完整渲染 mermaid 圖表與 LaTeX 公式**，由真正的 Chrome 負責排版。

一般的 Markdown 轉檔工具會把 ```mermaid 區塊原樣印成程式碼、把 `$$公式$$` 印成純文字。md2pdf 在真實瀏覽器中渲染它們，並且**在輸出前驗證每一張圖、每一條公式是否真的畫出來了** —— 沒畫出來就報錯，而不是給你一份看起來正常、實際上少東西的 PDF。

## 功能

- **mermaid 圖表** —— flowchart、sequence、class、state、ER、gantt 等
- **LaTeX 公式** —— 由 MathJax 排版
- **GitHub Flavored Markdown** —— 表格、待辦清單、刪除線、程式碼區塊
- **CJK 支援** —— 中日韓文字與字型處理
- **渲染驗證** —— 圖表或公式沒渲染成功就非零退出，不會產出殘缺的 PDF
- **離線可用** —— 前端資產全部釘版本並隨專案存放，安裝後不需要網路
- **跨平台** —— macOS、Linux、Windows

## 需求

- **Node.js 18 或以上**
- **Chrome、Chromium、Microsoft Edge 或 Brave** 任一（會自動偵測；也可用環境變數指定）

首次安裝需要網路連線，之後即可離線使用。

## 安裝

```bash
git clone https://github.com/t2o0n321/md2pdf.git
cd md2pdf
node bin/md2pdf.js setup
```

`setup` 會安裝相依套件並下載前端資產到專案內。完成後執行 `doctor` 確認環境：

```bash
node bin/md2pdf.js doctor
```

### 讓它可以從任何地方呼叫（選用）

```bash
# macOS / Linux：加進 ~/.bashrc 或 ~/.zshrc
alias md2pdf='node /path/to/md2pdf/bin/md2pdf.js'

# 或建立 symlink
ln -s /path/to/md2pdf/bin/md2pdf.js /usr/local/bin/md2pdf

# Windows PowerShell：加進 $PROFILE
function md2pdf { node C:\path\to\md2pdf\bin\md2pdf.js @args }
```

以下範例假設已設定為 `md2pdf`；若未設定，請改用 `node /path/to/md2pdf/bin/md2pdf.js`。

## 使用方式

```bash
md2pdf <輸入檔.md> [選項]
md2pdf setup [--force]
md2pdf doctor
md2pdf --help
```

### 指令

| 指令 | 說明 |
| :--- | :--- |
| `md2pdf <檔案.md>` | 轉檔。預設輸出到與輸入檔同目錄、同檔名的 `.pdf` |
| `md2pdf setup` | 安裝相依套件並下載前端資產。可重複執行，已安裝的會略過 |
| `md2pdf setup --force` | 同上，但強制重新下載前端資產 |
| `md2pdf doctor` | 顯示 Node 版本、平台、偵測到的瀏覽器、相依套件與資產狀態 |
| `md2pdf --help` | 顯示說明 |

### 選項

| 選項 | 預設值 | 說明 |
| :--- | :--- | :--- |
| `-o, --output <檔案>` | 輸入檔同目錄同檔名 | 指定輸出的 PDF 路徑。目錄不存在會自動建立 |
| `--format <尺寸>` | `A4` | 紙張尺寸，見下方清單。不分大小寫 |
| `--landscape` | 關閉（直向） | 橫向排版 |
| `--page-numbers` | 關閉 | 在頁尾印上「頁碼 / 總頁數」 |
| `--inline-math` | 關閉 | 啟用 `$...$` 行內公式。**含金額的文件請勿開啟**，見下方說明 |
| `--title <文字>` | 第一個 H1，否則用檔名 | PDF 的文件標題 |
| `--keep-html` | 關閉 | 保留中間產物 HTML 並顯示其路徑 |
| `--keep-html <路徑>` | — | 同上，但寫到指定路徑 |
| `--cdn` | 關閉 | 改從 CDN 載入前端資產，不使用本地版本 |
| `--no-verify` | 關閉 | 即使圖表或公式渲染失敗仍輸出 PDF |
| `-h, --help` | — | 顯示說明 |

#### `--format` 可用的尺寸

不分大小寫（`a4`、`A4`、`Letter`、`letter` 都可以）。輸入清單以外的值會直接報錯並列出可用選項。

| 尺寸 | 實際大小 |
| :--- | :--- |
| `A0` | 841 × 1189 mm |
| `A1` | 594 × 841 mm |
| `A2` | 420 × 594 mm |
| `A3` | 297 × 420 mm |
| `A4` （預設） | 210 × 297 mm |
| `A5` | 148 × 210 mm |
| `A6` | 105 × 148 mm |
| `Letter` | 216 × 279 mm（8.5 × 11 in） |
| `Legal` | 216 × 356 mm（8.5 × 14 in） |
| `Tabloid` | 279 × 432 mm（11 × 17 in） |
| `Ledger` | 279 × 432 mm（11 × 17 in，與 `Tabloid` 相同） |

搭配 `--landscape` 可將任一尺寸改為橫向，例如 `--format Ledger --landscape` 會得到 17 × 11 in。

### 環境變數

| 變數 | 說明 |
| :--- | :--- |
| `MD2PDF_CHROME` | 瀏覽器執行檔的絕對路徑。自動偵測失敗，或想指定特定瀏覽器時使用 |
| `MD2PDF_MIN_NODE` | 覆寫最低 Node 版本要求。預設 `18.0.0` |

```bash
# macOS / Linux
export MD2PDF_CHROME=/usr/bin/chromium

# Windows
set MD2PDF_CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe
```

### 離開代碼

| 代碼 | 意義 |
| :--- | :--- |
| `0` | 成功 |
| `1` | 失敗（渲染驗證未通過、找不到瀏覽器、輸入檔不存在、選項錯誤等） |

適合用在 CI 或腳本中判斷成敗。

### 範例

```bash
# 最基本：PDF 產在 md 旁邊
md2pdf report.md

# 指定輸出位置與頁碼
md2pdf notes.md -o ~/Documents/notes.pdf --page-numbers

# 橫向 A3，適合寬表格或大圖
md2pdf dashboard.md --format A3 --landscape

# 美式信紙 + 行內公式（文件中沒有金額時才建議）
md2pdf paper.md --format Letter --inline-math

# 調整版面樣式時，保留 HTML 方便在瀏覽器裡檢查
md2pdf doc.md --keep-html /tmp/preview.html

# 明知有圖表壞掉，仍要先產出 PDF
md2pdf draft.md --no-verify
```

## 關於行內公式（`--inline-math`）

`$$...$$` 區塊公式**永遠啟用**。`$...$` 行內公式**預設關閉**。

原因是：任何提到金額的文件（例如 `$5 / 月`、`$99 / 年`）一旦啟用行內公式，兩個錢字號之間的文字會被整段當成公式吃掉，排版出來完全走樣。只有在文件確實需要行內公式、且不含金額寫法時，才建議加上 `--inline-math`。

## 平台支援

| 平台 | 說明 |
| :--- | :--- |
| **macOS** | 自動偵測 `/Applications` 下的 Chrome、Chromium、Edge、Brave |
| **Linux** | 自動偵測發行版套件、`/opt`、snap 與 flatpak 安裝。**需自行安裝中日韓字型**，見下 |
| **Windows** | 自動偵測 `%PROGRAMFILES%`、`%PROGRAMFILES(X86)%` 與 `%LOCALAPPDATA%`（免管理員權限的個人安裝） |

### Linux：中日韓字型

乾淨的 Linux 環境通常**沒有預裝中日韓字型**。缺少字型時，每個中日韓字元都會印成空白方框，而圖表、公式、表格卻一切正常 —— 很容易誤以為轉檔成功。md2pdf 會偵測並擋下這種情況，同時提示安裝指令：

```bash
# Debian / Ubuntu
sudo apt install fonts-noto-cjk

# Fedora / RHEL
sudo dnf install google-noto-sans-cjk-fonts

# Arch
sudo pacman -S noto-fonts-cjk

# Alpine
apk add font-noto-cjk
```

### 在容器中使用

```bash
docker run --rm -v "$PWD:/work" -w /work node:22-slim bash -c \
  "apt-get update -qq && apt-get install -y -qq chromium fonts-noto-cjk && \
   node /path/to/md2pdf/bin/md2pdf.js /work/doc.md"
```

md2pdf 不需要對自己的目錄有寫入權限，可用唯讀方式掛載；中間產物一律寫到系統暫存目錄。

## 疑難排解

先執行 `md2pdf doctor`，它會列出 Node 版本、平台、偵測到的瀏覽器、相依套件與資產狀態。

| 問題 | 處理方式 |
| :--- | :--- |
| `Could not find Chrome/Chromium` | 安裝任一 Chromium 系瀏覽器，或用 `MD2PDF_CHROME` 指定執行檔路徑 |
| `puppeteer-core is not installed` | 執行 `md2pdf setup` |
| `Unknown paper format` | 使用 `--format` 支援清單中的尺寸 |
| 中日韓文字印成空白方框 | 安裝中日韓字型，見上方「Linux：中日韓字型」 |
| 圖表印成「Syntax error」方框 | mermaid 語法有誤。驗證會先擋下並指出幾張失敗，用 `--keep-html` 開來檢查 |
| 公式印成字面的 `$$...$$` | 該公式的 LaTeX 語法有誤，用 `--keep-html` 開來檢查 |
| 含金額的文字排版錯亂 | 移除 `--inline-math` |
| 在容器中渲染大文件時崩潰 | `/dev/shm` 太小，改用 `docker run --shm-size=1g` |
| 想調整字型、邊界或配色 | 修改 `lib/template.html` 中的 `<style>` |

## 測試

```bash
npm test
```

會在暫存目錄實際轉出 PDF，並檢查頁面尺寸、橫向排版、圖表與公式的渲染結果，以及「壞掉的圖表必須被擋下」等行為。

每次 push 與 pull request 都會自動在 **macOS、Linux、Windows** 上、以 **Node 18 與 22** 各跑一次同樣的測試。

## 授權

MIT — 詳見 [LICENSE](LICENSE)。
