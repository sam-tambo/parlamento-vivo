

## Plan: Create a temporary edge function to retrieve the service role key

The existing `get-service-key` function isn't deployed. I'll redeploy it using the edge function deployment tool.

### Steps

1. **Deploy the `get-service-key` edge function** using the deploy tool — this will make it callable at:
   ```
   https://ugyvgtzsvhmcohnooxqp.supabase.co/functions/v1/get-service-key
   ```

2. **You call it** with:
   ```bash
   curl https://ugyvgtzsvhmcohnooxqp.supabase.co/functions/v1/get-service-key
   ```

3. **Delete the function immediately** after you copy the key.

The function already exists in code and config.toml has `verify_jwt = false` set. It just needs to be deployed.

