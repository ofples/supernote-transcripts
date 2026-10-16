package tools.supernote.logincallback;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.ResultReceiver;
import android.widget.TextView;
import android.net.Uri;

public final class LoginActivity extends Activity {
 @Override public void onCreate(Bundle state) {
  super.onCreate(state);
  TextView message=new TextView(this);message.setTextSize(25);message.setPadding(32,32,32,32);setContentView(message);
  try {
   Uri input=getIntent().getData();
   if(input==null || !"supernote-login-helper".equals(input.getScheme()) || !"start".equals(input.getHost()))throw new Exception();
   String url=input.getQueryParameter("authorization");
   Uri auth=Uri.parse(url);
   String nonce=auth.getQueryParameter("state");
   if(!"https".equals(auth.getScheme()) || !"auth.openai.com".equals(auth.getHost()) || !"/api/accounts/authorize".equals(auth.getPath()) || auth.getUserInfo()!=null || auth.getPort()!=-1 || url.length()>10000 || nonce==null || !nonce.matches("[A-Za-z0-9_-]{43}") || !CallbackService.REDIRECT.equals(auth.getQueryParameter("redirect_uri")) || !"S256".equals(auth.getQueryParameter("code_challenge_method")))throw new Exception();
   ResultReceiver ready=new ResultReceiver(new Handler(getMainLooper())){
    @Override protected void onReceiveResult(int code,Bundle data){
     if(code!=0){message.setText("The local callback could not start. Return to Obsidian and retry.");return;}
     try{startActivity(new Intent(Intent.ACTION_VIEW,auth));finish();}
     catch(Exception ignored){message.setText("No browser could open sign-in. Return to Obsidian.");stopService(new Intent(LoginActivity.this,CallbackService.class));}
    }
   };
   startForegroundService(new Intent(this,CallbackService.class).putExtra("state",nonce).putExtra("ready",ready));
   message.setText("Opening ChatGPT sign-in…\n\nThe callback stays on this Nomad. This helper does not receive access or refresh tokens.");
  } catch(Exception ignored) { message.setText("Unable to start sign-in. Return to Obsidian and start a new attempt."); }
 }
}
