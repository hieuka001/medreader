#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(MedReaderBridgePlugin, "MedReaderBridge",
           CAP_PLUGIN_METHOD(getInfo, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(ocrImage, CAPPluginReturnPromise);
)
