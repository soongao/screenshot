import { contextBridge as o, ipcRenderer as e } from "electron";
o.exposeInMainWorld("electronAPI", {
  getDesktopSources: () => e.invoke("get-desktop-sources"),
  closeCapture: () => e.invoke("close-capture")
});
