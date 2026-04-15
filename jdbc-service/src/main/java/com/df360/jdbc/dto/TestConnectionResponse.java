package com.df360.jdbc.dto;

public class TestConnectionResponse {

    private boolean success;
    private String serverVersion;
    private long latencyMs;
    private String error;

    public TestConnectionResponse() {
    }

    public TestConnectionResponse(boolean success, String serverVersion, long latencyMs, String error) {
        this.success = success;
        this.serverVersion = serverVersion;
        this.latencyMs = latencyMs;
        this.error = error;
    }

    public boolean isSuccess() {
        return success;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public String getServerVersion() {
        return serverVersion;
    }

    public void setServerVersion(String serverVersion) {
        this.serverVersion = serverVersion;
    }

    public long getLatencyMs() {
        return latencyMs;
    }

    public void setLatencyMs(long latencyMs) {
        this.latencyMs = latencyMs;
    }

    public String getError() {
        return error;
    }

    public void setError(String error) {
        this.error = error;
    }
}
