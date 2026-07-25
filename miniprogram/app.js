// app.js
App({
  onLaunch: function () {
    this.globalData = {
      env: "cloud-space-d8gr80gd334789538",
      sessionReady: false,
    };
    if (!wx.cloud) {
      console.error("当前微信基础库不支持云开发能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
  },
});
