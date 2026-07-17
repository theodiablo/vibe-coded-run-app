package solutions.camboulive.run;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins. Must be registered before super.onCreate so the bridge
        // picks them up: WatchImport (post-run exercise import from Health Connect)
        // and RunPermissions (POST_NOTIFICATIONS for the recording-run notification).
        registerPlugin(WatchImportPlugin.class);
        registerPlugin(RunPermissionsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
