# md2pdf

[![CI](https://github.com/t2o0n321/md2pdf/actions/workflows/ci.yml/badge.svg)](https://github.com/t2o0n321/md2pdf/actions/workflows/ci.yml)

使用本機 Chromium 核心將 Markdown 轉換為高品質 PDF。完整支援 **Mermaid 圖表**、**LaTeX 數學公式** 與 **GFM 排版**，並具備即時渲染驗證機制，確保輸出的 PDF 內容完整無缺。

---

## 一、特色功能

- **完整 Mermaid 支援**：支援 Flowchart、Sequence、Class、State、ER、Gantt 等各類圖表。
- **LaTeX 公式排版**：內建 MathJax 引擎，美觀呈現數學與科學公式。
- **渲染防呆驗證**：轉檔時自動檢查每張圖表與公式是否成功繪製；若渲染失敗會立即報錯中斷，避免產出殘缺文件。
- **完全離線可用**：核心前端靜態資源已打包在專案內，首次 setup 後即可在無網路環境下運行。
- **完善的 CJK 支援**：針對中文、日文、韓文字型與排版進行優化，避免缺字與排版異常。
- **跨平台相容**：支援 macOS、Linux 與 Windows，自動偵測 Chrome、Chromium、Edge 或 Brave。

---

## 二、快速上手

### 二-1、系統需求

- **Node.js 18+**
- 系統中安裝有 **Chrome、Chromium、Microsoft Edge 或 Brave** 任一瀏覽器（會自動偵測）

### 二-2、安裝步驟

```bash
# 1. 複製專案
git clone https://github.com/t2o0n321/md2pdf.git
cd md2pdf

# 2. 安裝依賴與離線資源
node bin/md2pdf.js setup

# 3. 檢查環境設定是否就緒
node bin/md2pdf.js doctor
```

### 二-3、設定全域指令（選用）

為了方便在任意目錄使用 `md2pdf`，建議設定別名或建立軟連結：

```bash
# macOS / Linux（加進 ~/.zshrc 或 ~/.bashrc）
alias md2pdf='node /path/to/md2pdf/bin/md2pdf.js'

# 或建立軟連結 (Symlink)
ln -s /path/to/md2pdf/bin/md2pdf.js /usr/local/bin/md2pdf

# Windows PowerShell（加進 $PROFILE）
function md2pdf { node C:\path\to\md2pdf\bin\md2pdf.js @args }
```

---

## 三、常用範例

```bash
# 基本用法：輸出 PDF 到同目錄同檔名 (report.pdf)
md2pdf report.md

# 指定輸出路徑並加上頁碼
md2pdf notes.md -o ~/Documents/notes.pdf --page-numbers

# 橫向 A3 排版（適合寬表格、架構圖或甘特圖）
md2pdf architecture.md --format A3 --landscape

# 自訂字型與基礎字級
md2pdf paper.md --font "Noto Serif CJK TC" --font-size 13px

# 等比例縮放整頁（文字、圖表與頁邊距同步縮放）
md2pdf slides.md --scale 1.2

# 啟用行內公式（如：$E=mc^2$；注意：文件中若有金額 $ 請留意）
md2pdf math.md --inline-math

# 偵錯排版：保留產生的 HTML 檔案供瀏覽器檢視
md2pdf draft.md --keep-html ./debug.html
```

---

## 四、參數說明

### 四-1、指令列表

| 指令 | 說明 |
| :--- | :--- |
| `md2pdf <檔案.md>` | 將 Markdown 轉為 PDF（預設輸出至同目錄同檔名） |
| `md2pdf setup` | 安裝相依套件並準備離線資源（已安裝者會自動略過） |
| `md2pdf setup --force` | 強制重新下載並更新離線前端資源 |
| `md2pdf doctor` | 檢查 Node 版本、作業系統、瀏覽器路徑與資源狀態 |
| `md2pdf --help` | 顯示指令說明與參數列表 |

### 四-2、轉檔選項

| 選項 | 預設值 | 說明 |
| :--- | :--- | :--- |
| `-o, --output <路徑>` | `<輸入檔名>.pdf` | 指定輸出的 PDF 路徑（目錄若不存在會自動建立） |
| `--format <尺寸>` | `A4` | 紙張尺寸，支援 `A0`–`A6`、`Letter`、`Legal`、`Tabloid`、`Ledger`（不分大小寫） |
| `--landscape` | 關閉（直向） | 切換為橫向排版 |
| `--scale <倍率>` | `1` | 整頁等比例縮放（範圍 `0.1` ~ `2.0`） |
| `--font <字型>` | 內建字型庫 | 內文字型（可傳入逗號分隔字串，自動保留內建 CJK Fallback） |
| `--mono-font <字型>` | 內建等寬字型 | 程式碼區塊與行內代碼的字型 |
| `--font-size <大小>` | `12.5px` | 基礎字級大小（支援 `14px`、`11pt`、`1.1em` 或純數字） |
| `--page-numbers` | 關閉 | 在每頁頁尾加入「頁碼 / 總頁數」 |
| `--inline-math` | 關閉 | 啟用 `$...$` 行內數學公式（若文中有金額標示請斟酌開啟） |
| `--title <標題>` | 第一個 H1 / 檔名 | 設定 PDF 文件的 Metadata 標題 |
| `--keep-html [路徑]` | 關閉 | 保留中間渲染用的 HTML 檔案，方便排版調整與除錯 |
| `--cdn` | 關閉 | 改用線上 CDN 載入前端套件，而非本機離線資源 |
| `--no-verify` | 關閉 | 略過圖表與公式的渲染驗證，強制產出 PDF |

---

## 五、重點功能與注意事項

### 五-1、數學公式與行內語法 (`--inline-math`)
- **區塊公式** `$$...$$`：預設一律啟用。
- **行內公式** `$...$`：**預設為關閉狀態**。
  > 這是為了避免一般文章中的金額標示（如 `$10 / 月`、`特價 $99`）被誤判為公式而造成排版破裂。若您的文件確定包含行內數學公式且無一般金額標記，請加上 `--inline-math` 啟用。

### 五-2、字型設定與 Fallback 機制
使用 `--font` 或 `--mono-font` 指定字型時，指定的字型會**優先套用**，並自動串接系統內建的中日韓字型庫。

例如 `--font "Georgia"`，英文字會使用 Georgia，中文字則會自動 Fallback 回系統預設的中文字型（如蘋方、微軟正黑體或 Noto Sans），不用擔心指定英文字型導致中文變豆腐塊。

### 五-3、Linux / Docker 環境字型配置
純淨的 Linux 伺服器或容器通常缺少 CJK 中文字型，可能導致轉出的 PDF 中文變成空白方塊。轉檔前請確保系統已安裝中文字型：

```bash
# Ubuntu / Debian
sudo apt install fonts-noto-cjk

# Fedora / RHEL
sudo dnf install google-noto-sans-cjk-fonts

# Arch Linux
sudo pacman -S noto-fonts-cjk

# Alpine Linux
apk add font-noto-cjk
```

**Docker 執行範例：**
```bash
docker run --rm -v "$PWD:/work" -w /work node:22-slim bash -c \
  "apt-get update -qq && apt-get install -y -qq chromium fonts-noto-cjk && \
   node /path/to/md2pdf/bin/md2pdf.js /work/doc.md"
```

---

## 六、環境變數與 Exit Code

### 六-1、環境變數
- `MD2PDF_CHROME`：指定 Chromium / Chrome 執行檔的絕對路徑（當自動偵測失敗或想指定特定版本時使用）。
- `MD2PDF_MIN_NODE`：覆寫最低 Node.js 版本限制（預設 `18.0.0`）。

### 六-2、Exit Code
- `0`：轉檔成功。
- `1`：執行失敗（包含：圖表/公式驗證未過、找不到瀏覽器、輸入檔案不存在、參數錯誤等），適合在 CI/CD 流程中作為自動化判斷依據。

---

## 七、常見問題與排錯 (Troubleshooting)

| 問題狀況 | 建議解決方式 |
| :--- | :--- |
| `Could not find Chrome/Chromium` | 請先安裝 Chrome、Edge 等瀏覽器，或設定環境變數 `MD2PDF_CHROME` 指定路徑。 |
| `puppeteer-core is not installed` | 請先執行 `node bin/md2pdf.js setup` 安裝必要相依套件。 |
| 中日韓文字印出來變成方塊（豆腐塊） | 系統缺少中文字型，請參考上方 [五-3、Linux / Docker 環境字型配置](#五-3linux--docker-環境字型配置) 進行安裝。 |
| 圖表渲染失敗報錯（Syntax error） | Mermaid 語法可能有誤，可使用 `--keep-html preview.html` 保留 HTML 並於瀏覽器中排查。 |
| 公式顯示為原始文字 `$$...$$` | LaTeX 語法錯誤導致 MathJax 無法解析，請使用 `--keep-html` 檢查錯誤。 |
| 內文包含 `$` 導致排版混亂 | 若文中有標示價格，請移除 `--inline-math` 參數。 |
| 想要自訂全域 CSS 樣式與版面邊距 | 可直接編輯 `lib/template.html` 中的 `<style>` 樣式區塊。 |

---

## 八、執行測試

本專案包含完整的自動化測試，涵蓋各類圖表公式渲染、紙張方向、尺寸驗證與防呆機制：

```bash
npm test
```

---

## 九、授權條款

本專案採用 [MIT License](LICENSE) 授權。
