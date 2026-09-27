package com.vyapaarsetu.app;

import android.content.Context;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Inject Native Android Print Interface into Capacitor WebView
        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().addJavascriptInterface(new AndroidPrintInterface(), "AndroidNativePrint");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public class AndroidPrintInterface {
        @JavascriptInterface
        public void printReceipt() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                        if (printManager != null && bridge != null && bridge.getWebView() != null) {
                            String jobName = "VyaparSetu-Receipt-" + System.currentTimeMillis();
                            PrintDocumentAdapter printAdapter = bridge.getWebView().createPrintDocumentAdapter(jobName);
                            PrintAttributes.Builder builder = new PrintAttributes.Builder();
                            builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4);
                            printManager.print(jobName, printAdapter, builder.build());
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            });
        }
    }
}
