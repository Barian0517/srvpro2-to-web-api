# YGO DIY Card API Server

這是一個基於 Node.js 與 Express 建立的後端 API 伺服器，專門用來讀取與解析 YGOPro 的自製卡片 (DIY Card) 資料庫。它能夠為前端應用程式提供完整的卡片數據、圖片與腳本資源。

## ✨ 主要功能

- **動態設定檔讀取**：自動讀取 srvpro 伺服器的 `config.yaml`，提取 `ygoproPath` 內設定的卡片資料夾（並自動過濾基礎庫 `./ygopro`）。
- **多資料夾整合**：支援同時載入多個資料夾下的 `.cdb` (SQLite) 卡片資料庫。
- **提供完整卡片資訊**：解析遊戲王卡片的屬性、種族、攻擊力、守備力與效果文。
- **靜態資源伺服**：自動橫跨所有資料夾尋找並提供對應卡片 ID 的圖片 (`pics/*.jpg` 或 `*.png`) 以及 Lua 腳本 (`script/c*.lua`)。
- **全自動打包下載**：伺服器啟動時會自動掃描所有資料夾下的 `.ypk` 檔案，並打包成一個完整的 `bundle.zip` 供前端一鍵下載。
- **熱重載資料**：提供 `/api/refresh` 端點，讓您在新增卡片後無需重啟伺服器即可重新載入資料庫。

---

## 🚀 系統需求

- [Node.js](https://nodejs.org/) (建議 v16 以上版本)
- NPM (隨 Node.js 一併安裝)

## 📦 安裝與啟動

1. **安裝依賴套件**
   在伺服器根目錄下開啟終端機，執行以下指令安裝所需套件：
   ```bash
   npm install
   ```

2. **設定環境變數**
   在根目錄下建立或修改 `.env` 檔案，內容如下：
   ```env
   PORT=3000
   
   # 指定您的 config.yaml 絕對路徑
   CONFIG_YAML_PATH=C:\Users\user\Desktop\code\YGO DIY card\app\srvpro2\config.yaml
   
   # (備用) 如果不使用 config.yaml，也可以直接指定單一資料夾
   # DIY_CARD_DIR=C:\Users\user\Desktop\code\YGO DIY card\app\srvpro2\ygopro\fallenangle
   ```
   > ⚠️ **注意**：為了確保跨作業系統下（尤其是 Linux）圖片與腳本能夠順利下載，強烈建議將 `CONFIG_YAML_PATH` 填寫為**絕對路徑**（如 `/opt/server/config.yaml` 或 `C:\...`）。

3. **啟動伺服器**
   ```bash
   node index.js
   ```
   啟動成功後，終端機會顯示載入的卡片數量與監聽的資料夾。預設會在 `http://localhost:3000` 運行。

---

## 📡 API 端點介紹

伺服器預設啟用了 CORS 跨域資源共用，可以直接供任何前端 (如 localhost 上的 Vue / React 應用) 呼叫。

### 1. 取得伺服器狀態與目錄
- **端點**: `GET /api/info`
- **功能**：回傳伺服器正在監控的資料夾清單、讀取到的卡片總數與資料庫數量。

### 2. 取得所有卡片摘要清單
- **端點**: `GET /api/cards`
- **功能**：回傳所有卡片的基本資訊 (ID, 名稱, 類型, 等級, 攻防, 屬性, 種族)，適合用於列表顯示。

### 3. 取得單張卡片詳細資訊
- **端點**: `GET /api/cards/:id`
- **功能**：透過卡片 ID 取得卡片的完整資料 (包含效果文)。API 會自動檢查是否有對應的圖片 (`hasImage`, `imageType`) 與腳本 (`hasScript`) 並回傳旗標。

### 4. 取得卡片圖片
- **端點**: `GET /api/images/:id`
- **功能**：直接回傳卡片的圖片檔案 (.jpg 或 .png)，可直接作為 `<img src="...">` 使用。

### 5. 取得卡片 Lua 腳本
- **端點**: `GET /api/scripts/:id`
- **功能**：以純文字格式 (`text/plain`) 回傳卡片的 Lua 腳本內容。

### 6. 下載 YPK 擴充包 (ZIP 打包)
- **端點**: `GET /api/download/ypk`
- **功能**：下載由伺服器自動將所有 `.ypk` 檔案打包而成的 `bundle.zip` 壓縮檔。

### 7. 重新載入資料庫
- **端點**: `POST /api/refresh`
- **功能**：重新掃描設定的資料夾，讀取最新變動的 `.cdb` 資料庫。適用於您剛放入新卡片後呼叫。
