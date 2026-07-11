package solutions.camboulive.run;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin: post-run watch import from Health Connect. Must be
        // registered before super.onCreate so the bridge picks it up.
        registerPlugin(WatchImportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
