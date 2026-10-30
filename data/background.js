chrome.action.onClicked.addListener(() => {
  // Chrome Extension wajib memanggil file HTML fisik saat membuat tab,
  // lalu URL "/index.html" otomatis dihapus dari address bar oleh history.replaceState di app.js
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});
