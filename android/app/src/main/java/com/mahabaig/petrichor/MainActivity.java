package com.mahabaig.petrichor;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins register before the bridge starts.
        registerPlugin(PrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
