# md2pdf

[![CI](https://github.com/t2o0n321/md2pdf/actions/workflows/ci.yml/badge.svg)](https://github.com/t2o0n321/md2pdf/actions/workflows/ci.yml)

使用本機 Chromium 核心將 Markdown 轉換為高品質 PDF。完整支援 **Mermaid 圖表**、**LaTeX 數學公式** 與 **GFM 排版**，並具備即時渲染驗證機制，確保輸出的 PDF 內容完整無缺。

---

## 一、特色功能

- **完整 Mermaid 支援**：支援 Flowchart、Sequence、Class、State、ER、Gantt 等各類圖表。
- **Mermaid 圖片匯出**：`md2pdf mermaid` 可將文件內的 Mermaid 圖表逐張匯出成獨立圖片檔（SVG／PNG），文件裡有 N 張圖就輸出 N 個檔案，其餘內容一律略過。PNG 預設以 3 倍解析度重新繪製，畫質銳利。
- **LaTeX 公式排版**：內建 MathJax 引擎，美觀呈現數學與科學公式。
- **渲染防呆驗證**：轉檔時自動檢查每張圖表與公式是否成功繪製；若渲染失敗會立即報錯中斷，避免產出殘缺文件。
- **完全離線可用**：核心前端靜態資源已打包在專案內，首次 setup 後即可在無網路環境下運行。
- **完善的 CJK 支援**：針對中文、日文、韓文字型與排版進行優化，避免缺字與排版異常。
- **原生 HTML 支援**：Markdown 允許直接寫 HTML，這裡照著渲染。手寫的 `<table>`／`<img>` 版面、`align=`／`valign=` 對齊、`width=` 寬度都會生效；`<details>` 會自動展開（PDF 裡沒人能點開它）；相對路徑（`images/shot.png`）以 **Markdown 檔所在目錄** 為基準解析，不是產生的暫存 HTML。文件裡出現 `<script>` 標籤也照樣轉檔。
- **完整 GFM 語法**：表格對齊列（`|:---:|`）、待辦清單、刪除線、自動連結、**註腳** `[^1]`，以及自動產生的標題 id —— `- [跳到某節](#某節)` 這種目錄在 PDF 裡是真的可以跳的內部連結。
- **Obsidian 語法支援**：可直接轉換 Obsidian 筆記，支援 `![[圖片]]` 嵌入、`> [!NOTE]` 標註方塊、`[[雙向連結]]` 與 `==螢光標記==`。
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

# 轉換 Obsidian 筆記（![[嵌入]]、[!NOTE] 標註等自動處理）
md2pdf ~/vault/notes/會議記錄.md

# 偵錯排版：保留產生的 HTML 檔案供瀏覽器檢視
md2pdf draft.md --keep-html ./debug.html
```

### 三-1、匯出 Mermaid 圖片

```bash
# 把 architecture.md 裡每一張 Mermaid 圖各存成一個 SVG（預設輸出到同目錄）
md2pdf mermaid architecture.md

# 指定輸出目錄
md2pdf mermaid architecture.md -o ./diagrams

# 輸出高解析度 PNG（預設就是 3 倍，此處明確指定 4 倍）
md2pdf mermaid architecture.md --type png --scale 4 -o ./diagrams

# 透明背景 PNG，適合貼進深色簡報
md2pdf mermaid slides.md --type png --background transparent -o ./assets

# 指定主題與圖表標籤字型（中文字型 Fallback 會自動保留）
md2pdf mermaid report.md --theme neutral --font "Noto Sans CJK TC"

# 自訂檔名前綴，輸出 arch-01.svg、arch-02.svg ...
md2pdf mermaid report.md --prefix arch -o ./diagrams
```

---

## 四、參數說明

### 四-1、指令列表

| 指令 | 說明 |
| :--- | :--- |
| `md2pdf <檔案.md>` | 將 Markdown 轉為 PDF（預設輸出至同目錄同檔名） |
| `md2pdf mermaid <檔案.md>` | 將文件內的 Mermaid 圖表逐張匯出為圖片檔，不產生 PDF |
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

### 四-3、Mermaid 圖片匯出選項（`md2pdf mermaid`）

| 選項 | 預設值 | 說明 |
| :--- | :--- | :--- |
| `-o, --out <目錄>` | 輸入檔所在目錄 | 圖片輸出目錄（不存在會自動建立） |
| `--type <svg\|png>` | `svg` | 輸出格式。SVG 為向量，任意縮放都清晰；PNG 為點陣 |
| `--scale <倍率>` | PNG `3`／SVG `1` | 尺寸倍率（範圍 `0.1` ~ `10`），詳見 [五-5](#五-5mermaid-圖片匯出) |
| `--prefix <名稱>` | 輸入檔名 | 檔名前綴，輸出為 `<前綴>-01.svg`、`<前綴>-02.svg`… |
| `--theme <主題>` | `default` | Mermaid 主題：`default`、`neutral`、`dark`、`forest`、`base` |
| `--background <色值>` | `white` | 任何 CSS 色值，或 `transparent` 代表透明背景 |
| `--font <字型>` | Mermaid 內建字型 | 圖表標籤字型（自動串接內建 CJK Fallback）。**C4 圖表除外**，原因見下 |
| `--html-labels` | 關閉 | 以 HTML 繪製標籤（與 PDF 完全一致，但在 Illustrator／Inkscape／Figma 中文字會消失） |
| `--cdn` | 關閉 | 改用線上 CDN 載入前端套件 |
| `--no-verify` | 關閉 | 略過驗證：跳過渲染失敗的圖表，只輸出成功的部分 |
| `--keep-html [路徑]` | 關閉 | 保留中間渲染用的 HTML 檔案 |

> [!NOTE]
> `--format` 在 PDF 指令中是**紙張尺寸**，在此指令中沒有意義。若誤輸入 `md2pdf mermaid x.md --format A4`，程式會直接指出這是紙張尺寸並提示改用 `--type`。
> 同理 `--scale` 在 PDF 指令上限為 `2.0`（Chrome 列印 API 的限制），圖片匯出沒有這個限制，上限為 `10`。

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

### 五-4、Obsidian 語法支援

可直接把 Obsidian 筆記轉成 PDF，無需事先改寫語法。

| 語法 | 轉換結果 |
| :--- | :--- |
| `![[圖片.png]]` | 嵌入圖片 |
| `![[圖片.png\|400]]` | 指定寬度（亦支援 `\|寬x高`） |
| `> [!NOTE]` | 標註方塊（含顏色與標題） |
| `> [!WARNING] 自訂標題` | 標註方塊，使用自訂標題 |
| `> [!TIP]-` / `+` | 接受折疊標記並忽略（PDF 無法折疊） |
| `[[筆記名稱]]` | 樣式化文字 |
| `[[筆記名稱\|別名]]` | 顯示別名 |
| `==螢光標記==` | 螢光底色 |

標註類型支援 Obsidian 全套與 GitHub 五種（`note`、`tip`、`important`、`warning`、`caution`、`info`、`success`、`question`、`failure`、`danger`、`bug`、`example`、`quote` 及其常見別名），**不分大小寫**。

**圖片的尋找順序**：先以字面路徑解析，接著依序尋找 `images/`、`attachments/`、`assets/`、`media/` 等慣例資料夾，最後以檔名在筆記所在目錄樹中搜尋（比照 Obsidian 以檔名跨 vault 解析的行為）。

> [!NOTE]
> 找不到的嵌入檔案會**直接報錯並列出檔名**，而非印出一塊空白。
> 程式碼區塊與行內程式碼中的 `![[...]]`、`[[...]]`、`==...==` 一律**原樣保留**，不會被誤判成語法。

### 五-5、Mermaid 圖片匯出

`md2pdf mermaid` 只做一件事：把文件裡的 Mermaid 圖表逐張抓出來、各存成一個獨立圖片檔。**文件裡有 N 張圖就輸出 N 個檔案**，內文、表格、公式、圖片一律略過，也不會產生 PDF。

> [!NOTE]
> 這是**重新渲染**，不是從 PDF 裡把圖摳出來 —— 不需要先產生 PDF，兩個指令也互不影響。圖片是直接從 Markdown 原始碼重新畫一次，因此不受 PDF 的紙張尺寸、邊界或縮放影響，圖表有多大就輸出多大。

#### 檔名與編號

輸出檔名為 `<前綴>-01.svg`、`<前綴>-02.svg`…，前綴預設是輸入檔名，編號依**文件中出現的順序**固定補到兩位數。

- 編號代表「這是文件裡的第幾張圖」，不是「第幾個成功的圖」。所以若第 2 張圖渲染失敗並加上 `--no-verify`，輸出會是 `-01`、`-03`，**中間留空號**，一眼就能看出少了哪一張，其餘檔名也不會因此位移。
- 補到固定兩位數（而非依總數決定位數），所以文件從 9 張圖增加到 10 張時，前 9 個檔名不會被改動 —— 否則所有引用這些圖片的文件都會一起失效。
- 若上一次執行產生的檔案這次沒有被覆寫（例如圖表被刪掉了），程式會**列出這些殘留檔案提醒你**，但不會自動刪除 —— 那是你的檔案，不是本工具該處理的。

#### 抓取範圍與 PDF 完全一致

擷取是在瀏覽器內用同一套 Markdown 解析器完成的，與 PDF 路徑逐步相同，所以兩個指令對「這份文件有哪些圖表」的判斷不可能不一致。這也代表下列寫法都會被正確處理，而單純用正規表達式掃原始碼則會抓錯：

| 寫法 | 結果 |
| :--- | :--- |
| ` ```mermaid ` 圍欄 | 匯出 |
| `~~~mermaid` 波浪號圍欄 | 匯出 |
| 四個以上反引號的圍欄 | 匯出 |
| 縮排在清單項目或引言塊裡的圍欄 | 匯出 |
| `<div class="mermaid">` 原生 HTML | 匯出（PDF 也會畫） |
| 被更外層圍欄包住的 ` ```mermaid `（即「在介紹 Mermaid 語法」） | **不匯出**，那是程式碼範例而非圖表 |

#### SVG 還是 PNG？

| | SVG（預設） | PNG |
| :--- | :--- | :--- |
| 型態 | 向量，任意放大都清晰 | 點陣 |
| 檔案大小 | 小 | 較大 |
| `--scale` 的意義 | 只改變檔案「宣告」的顯示尺寸，畫質與它無關 | 以 N 倍解析度**重新繪製**（非放大既有點陣） |
| 預設倍率 | `1`（原尺寸） | `3`（高畫質） |
| 適用場景 | 網頁、Git 版控、需要再編輯 | 簡報、聊天軟體、不支援 SVG 的平台 |

PNG 預設 `--scale 3`：圖表在網頁上的原始寬度往往只有 300 多像素，1 倍輸出在高解析度螢幕或列印時會明顯模糊。由於來源是向量，3 倍是由 Chrome **重新光柵化**整張圖，文字與線條都是重繪而非拉伸，代價只有檔案大小。

> [!NOTE]
> SVG 預設輸出的標籤是 `<text>` 文字元素（而非 `<foreignObject>`），因此在 Illustrator、Inkscape、Figma、librsvg 等非瀏覽器環境開啟時文字**不會消失**。若你只在瀏覽器中使用、想要與 PDF 完全一致的標籤呈現，可加上 `--html-labels`。
> 例外：`journey` 類型的圖表本身一定會使用 `foreignObject`，這是 Mermaid 的實作限制。

#### 字型（`--font`）

`--font` 會換掉圖表標籤的字型，並自動在後面串接內建的 CJK Fallback，因此指定英文字型也不會讓中文變成空白方塊。

**唯一的例外是 C4 圖表**：Mermaid 繪製 C4 時會忽略字型設定，用寫死的 Open Sans 去量測文字寬度，再把結果畫進**寬度已經固定**的方框裡。若事後替換字型，文字會超出方框 —— 而 C4 的文字是白色、背景也是白色，超出的字會直接消失（實測以 `--font "Courier New"` 會讓 `A customer of the bank...` 變成 `ustomer of the bank...`，頭尾各被吃掉一截）。**掉字比「字型沒套用」嚴重得多**，所以 C4 一律保留它量測時所用的字型。

#### 標籤中的 `<`、`&`、`>`

不同圖表類型對標籤的處理不一致：flowchart、class、state、block、gantt、pie 會把標籤多跳脫一層（`5 < 6` 會變成畫面上看得見的 `&lt;`），而 sequence、er、journey、timeline、mindmap、C4 則是原樣寫入。本工具**只對前者**還原一層跳脫。

這個界線是刻意畫的：漏還原只是畫面上多出 `&lt;`，看得見也改得掉；但對「原樣寫入」的類型多還原一次會**直接破壞內容** —— 例如 sequence 圖裡的網址 `?id=5&reg=US&copy=1` 會變成 `?id=5®=US©=1`，而且圖片上完全看不出發生過什麼事。

#### 背景與透明

背景是畫在 SVG 內部的一個矩形，而不是「螢幕截圖時後面那層顏色」，所以 SVG 與 PNG 的輸出結果一致，`--background transparent` 也能產出真正帶 Alpha 通道的透明 PNG。

#### 渲染驗證（防呆）

沿用本工具一貫的原則：**寧可報錯，也不要輸出殘缺的檔案**。下列情況預設一律報錯並中斷，且**一個檔案都不會寫出**（避免輸出目錄一半是新的、一半是上次的）：

- 圖表語法錯誤（會列出 Mermaid 的解析錯誤訊息與是第幾張圖）。
- 圖表渲染成一張空白圖 —— 例如 ` ```mermaid ` 內只寫了 `flowchart TD` 卻沒有任何節點。Mermaid 對這種情況**不會報錯**，會安靜地產生一張 16×16 的空白圖，因此本工具額外檢查尺寸。
- 文件內含中日韓文字，但系統找不到任何能繪製的字型（見 [五-3](#五-3linux--docker-環境字型配置)）。這在 PNG 上尤其致命：空白方塊會永久烙進點陣圖裡，無法事後補救。
- 文件內完全沒有 Mermaid 圖表（通常代表指定錯檔案，或圍欄沒有標記 `mermaid`）。

加上 `--no-verify` 則改為「輸出成功的部分、其餘跳過並列出原因」，exit code 為 `0`。

#### 可重現輸出

同一份輸入重複執行會產生**位元組完全相同**的檔案，因此把匯出的 SVG 一起提交進 Git 不會每次都產生整檔差異。
唯一例外是 `gitGraph`：Mermaid 會為每個 commit 產生隨機短雜湊，本工具無法介入。

---

## 六、環境變數與 Exit Code

### 六-1、環境變數
- `MD2PDF_CHROME`：指定 Chromium / Chrome 執行檔的絕對路徑（當自動偵測失敗或想指定特定版本時使用）。
- `MD2PDF_MIN_NODE`：覆寫最低 Node.js 版本限制（預設 `18.0.0`）。

### 六-2、Exit Code
- `0`：轉檔成功。
- `1`：執行失敗（包含：圖表/公式驗證未過、找不到瀏覽器、輸入檔案不存在、參數錯誤等），適合在 CI/CD 流程中作為自動化判斷依據。

`md2pdf mermaid` 遵循同一套規則：任何一張圖渲染失敗、或文件內沒有圖表，都會回傳 `1` 且不寫出任何檔案；加上 `--no-verify` 則回傳 `0` 並輸出成功的部分。

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
| `embedded file(s) could not be found` | Obsidian 嵌入的圖片不在筆記目錄樹內；請確認附件資料夾與筆記在同一層或其子目錄下。 |
| 圖片印出來是空白 | 檢查輸出摘要的 `N/M images`；數字不相等代表有圖片載入失敗。 |
| `contains no mermaid diagrams` | 指定的檔案裡沒有 Mermaid 圖表。請確認檔案正確，且圍欄有標記為 ` ```mermaid `。 |
| `rendered empty (16x16 px)` | 該圍欄只寫了圖表類型卻沒有內容（例如只有 `flowchart TD`）。補上節點，或用 `--no-verify` 跳過。 |
| 匯出的 SVG 在 Illustrator／Figma 中文字消失 | 該檔案是用 `--html-labels` 產生的。改用預設（不加該參數）即可輸出為 `<text>` 文字元素。 |
| 匯出的 PNG 不夠清晰 | 提高倍率，例如 `--scale 5`；或直接改用 `--type svg` 向量輸出。 |
| `too large for Chrome to rasterise` | 圖表尺寸 × 倍率超出 Chrome 的記憶體上限。請降低 `--scale`，或改用 `--type svg`（無此限制）。 |
| `--out must be a directory` | `-o` 在此指令中指定的是**目錄**而非單一檔案（因為一張圖一個檔）。 |

---

## 八、執行測試

本專案包含完整的自動化測試，涵蓋各類圖表公式渲染、紙張方向、尺寸驗證、Mermaid 圖片匯出與各項防呆機制：

```bash
npm test
```

測試會實際啟動瀏覽器並驗證**產出的檔案本身**，而非只檢查程式有沒有報錯 —— 例如把匯出的 SVG 重新開起來確認它是合法且畫得出東西的檔案、直接讀 PNG 的位元組確認解析度與透明通道、以及比對兩次執行的輸出是否完全一致。

CI 於 `ubuntu-latest`、`windows-latest`、`macos-latest` 三個平台 × Node 18／22 共六種組合上執行。

---

## 九、授權條款

本專案採用 [MIT License](LICENSE) 授權。
