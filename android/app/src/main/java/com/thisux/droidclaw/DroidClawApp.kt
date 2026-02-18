package com.thisux.droidclaw

import android.app.Application
import com.thisux.droidclaw.data.SettingsStore
import com.thisux.droidclaw.data.WorkflowStore

class DroidClawApp : Application() {
    lateinit var settingsStore: SettingsStore
        private set
    lateinit var workflowStore: WorkflowStore
        private set

    override fun onCreate() {
        super.onCreate()
        settingsStore = SettingsStore(this)
        workflowStore = WorkflowStore(this)
    }
}
