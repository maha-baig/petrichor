package com.mahabaig.petrichor;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Print / PDF for the app. Android's WebView ignores window.print(), so the
 * manuscript's HTML (see printManuscript in src/manuscriptExport.js) is laid
 * out in a WebView of its own and handed to the system print dialog, which
 * offers "Save as PDF" as well as real printers.
 */
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {

    // Held until the next print, so the page isn't collected mid-layout.
    private WebView printView;

    @PluginMethod
    public void print(PluginCall call) {
        final String html = call.getString("html");
        final String name = call.getString("name", "Petrichor");
        if (html == null || html.isEmpty()) {
            call.reject("Nothing to print.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            WebView view = new WebView(getContext());
            printView = view;
            view.setWebViewClient(new WebViewClient() {
                private boolean sent = false;

                @Override
                public void onPageFinished(WebView page, String url) {
                    if (sent) return;
                    sent = true;
                    PrintManager printer = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    printer.print(name, page.createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
                    call.resolve();
                }
            });
            view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }
}
