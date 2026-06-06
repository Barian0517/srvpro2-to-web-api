# YGO DIY Card API Server

這是一個基於 Node.js 與 Express 建立的後端 API 伺服器，專門用來讀取與解析 YGOPro 的自製卡片 (DIY Card) 資料庫。它能夠為前端應用程式提供完整的卡片數據、圖片與腳本資源。

## ✨ 主要功能

- **動態設定檔讀取**：自動讀取 srvpro 伺服器的 `config.yaml`，提取 `ygoproPath` 內設定的卡片資料夾（並自動過濾基礎庫 `./ygopro`）。
- **多資料夾整合**：支援同時載入多個資料夾下的 `.cdb` (SQLite) 卡片資料庫。
- **提供完整卡片資訊**：解析遊戲王卡片的屬性、種族、攻擊力、守備力與效果文。
- **靜態資源伺服**：自動橫跨所有資料夾尋找並提供對應卡片 ID 的圖片 (`pics/*.jpg` 或 `*.png`) 以及 Lua 腳本 (`script/c*.lua`)。
- **全自動打包下載**：伺服器啟動時會自動掃描所有資料夾下的 `.ypk` 檔案，並打包成一個完整的 `bundle.zip` 供前端一鍵下載。
- **Hash 計算與校驗**：自動計算 `bundle.zip` 的 SHA-256 Hash，並提供 API 供前端校驗擴充包是否已更新。
- **自動監控與熱重載**：伺服器會自動監控卡包資料夾的檔案變動，一旦偵測到新增或修改，即自動重新載入資料庫並重新壓縮打包，全程無須手動重啟伺服器。亦保留 `/api/refresh` 手動觸發端點作為備用。

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
   
   # 資料庫連線字串 (srvpro2 的 PostgreSQL)
   DB_URI=postgresql://srvpro:CHANGE_ME_DB_PASS@10.0.0.10:5433/srvpro2

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
- **功能**：回傳伺服器正在監控的資料夾清單、讀取到的卡片總數、資料庫數量以及當前 `bundle.zip` 的 SHA-256 Hash。

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
- **功能**：手動觸發重新掃描設定的資料夾，讀取最新變動的 `.cdb` 資料庫並重新打包。因系統已內建自動監控更新功能，此 API 可作為備用操作。

### 8. 取得當前 YPK 擴充包的 Hash
- **端點**: `GET /api/hash`
- **功能**：回傳當前打包完成的 `bundle.zip` 的 SHA-256 Hash，格式如 `{"hash": "..."}`。方便前端比對判斷是否需要提示使用者下載新的擴充包。

---

## 📊 決鬥統計與重播 API (Stats & Replays)

伺服器現已整合 PostgreSQL 資料庫，支援對局紀錄查詢、玩家勝率排行與重播下載功能。
所有統計 API 皆支援傳入 `?month=YYYY-MM` 的 Query 參數（預設為當前月份）。

### 1. 取得有對局紀錄的月份列表
- **端點**: `GET /api/stats/months`
- **功能**：回傳資料庫中所有曾經發生過對戰的月份陣列，供前端選單使用。

### 2. 玩家勝場排行榜
- **端點**: `GET /api/stats/players?month=YYYY-MM`
- **功能**：統計該月參與過決鬥的玩家名單，並依據勝場數 (`winCount`) 與總對局數 (`totalMatches`) 由高至低排序回傳。

### 3. 特定玩家使用的牌組列表
- **端點**: `GET /api/stats/players/:name/decks?month=YYYY-MM`
- **功能**：取得特定玩家在當月使用過的獨立牌組。回傳解析後的卡片資訊陣列（將 Base64 轉換為卡片 ID 與名稱）。

### 4. 特定玩家的詳細對戰紀錄
- **端點**: `GET /api/stats/players/:name/records?month=YYYY-MM`
- **功能**：列出該玩家當月所有的對局歷程。包含對手名稱、雙方使用的牌組（卡片名稱陣列）、勝負結果與對局發生時間。

### 5. 當月熱門卡片排行
- **端點**: `GET /api/stats/cards/ranking?month=YYYY-MM`
- **功能**：分析當月所有玩家使用過的牌組，統計每張卡片的上場次數，並回傳使用率最高的 Top 50 卡片排行。

### 6. 全域重播紀錄列表
- **端點**: `GET /api/stats/replays?month=YYYY-MM`
- **功能**：取得當月所有對局的列表，包含交戰雙方的玩家名稱、使用的牌組張數、以及對局時間。

### 7. 單局重播詳細資訊
- **端點**: `GET /api/stats/replays/:id`
- **功能**：取得特定單局決鬥的雙方詳細使用牌組（卡片名稱陣列）及勝負結果。

### 8. 下載重播檔案 (.yrp)
- **端點**: `GET /api/stats/replays/:id/download`
- **功能**：將資料庫中二進位的 `messages` 資料包裝為標準的 `.yrp` 遊戲王重播檔案。前端可提供該檔案下載，或是直接將二進位流導給 Web HTML5 版的 YGOPro 播放器觀看。

### 9. 下載重播玩家牌組 (.ydk)
- **端點**: `GET /api/stats/replays/:id/deck/:player`
- **功能**：將該重播紀錄中指定玩家的牌組資料解析後，組合為 `.ydk` 格式提供下載。參數 `:player` 請帶入 `1` 或 `2` 代表玩家 1 與玩家 2。如果該重播紀錄中包含非自製卡片（如原版遊戲王卡），將會直接保留卡片 ID，匯入客戶端時會自動辨識。
