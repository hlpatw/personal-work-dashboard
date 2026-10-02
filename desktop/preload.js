const { contextBridge, ipcRenderer } = require('electron');

// 暴露给宠物页面的最小桌面能力
contextBridge.exposeInMainWorld('desktop', {
  /** 点宠物：打开/收起面板窗口 */
  toggleDashboard: () => ipcRenderer.send('toggle-dashboard'),
  /** 右键宠物：弹出菜单 */
  openMenu: () => ipcRenderer.send('pet-menu'),
});
