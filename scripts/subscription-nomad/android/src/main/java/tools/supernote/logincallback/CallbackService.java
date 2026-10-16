package tools.supernote.logincallback;

import android.app.*;
import android.content.Intent;
import android.net.Uri;
import android.os.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.JSONObject;

public final class CallbackService extends Service {
 public static final int PORT=19456;
 public static final String REDIRECT="http://127.0.0.1:"+PORT+"/auth/callback";

 private final Object lock=new Object();
 private final Handler handler=new Handler(Looper.getMainLooper());
 private ServerSocket listener;
 private boolean starting;
 private boolean destroyed;
 private long listenerGeneration;
 private long attempt;
 private int latestStartId;
 private String state;
 private JSONObject result;
 private long resultAttempt=-1;
 private ResultReceiver latestReady;
 private Runnable timeout;

 @Override public IBinder onBind(Intent intent){return null;}

 @Override public int onStartCommand(Intent intent,int flags,int startId){
  if(intent==null){stopSelf(startId);return START_NOT_STICKY;}
  NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
  nm.createNotificationChannel(new NotificationChannel("login","ChatGPT sign-in",NotificationManager.IMPORTANCE_LOW));
  startForeground(1,new Notification.Builder(this,"login").setSmallIcon(android.R.drawable.ic_lock_lock).setContentTitle("Waiting for ChatGPT sign-in").setContentText("Local callback · closes after sign-in or ten minutes").build());

  String newState=intent.getStringExtra("state");
  ResultReceiver ready=intent.getParcelableExtra("ready");
  if(newState==null || !newState.matches("[A-Za-z0-9_-]{43}")){
   if(ready!=null)ready.send(1,null);
   synchronized(lock){
    if(state==null)stopSelf(startId);
    else latestStartId=startId;
   }
   return START_NOT_STICKY;
  }

  long thisAttempt;
  synchronized(lock){
   thisAttempt=++attempt;
   latestStartId=startId;
   state=newState;
   result=null;
   resultAttempt=-1;
   latestReady=ready;
   if(timeout!=null)handler.removeCallbacks(timeout);
   timeout=()->{
    synchronized(lock){if(attempt!=thisAttempt || destroyed)return;stopSelf(latestStartId);}
   };
   handler.postDelayed(timeout,600000);
   if(listener!=null && !listener.isClosed() && listener.isBound()){
    if(ready!=null)ready.send(0,null);
    latestReady=null;
   }else if(!starting){
    starting=true;
    startListener(++listenerGeneration);
   }
  }
  return START_NOT_STICKY;
 }

 private void startListener(long generation){
  new Thread(()->{
   ServerSocket opened=null;
   try{
    opened=new ServerSocket();
    opened.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),PORT));
    synchronized(lock){
     if(destroyed || generation!=listenerGeneration){
      try{opened.close();}catch(IOException ignored){}
      return;
     }
     listener=opened;
     starting=false;
     if(latestReady!=null)latestReady.send(0,null);
     latestReady=null;
    }
    while(!opened.isClosed())try(Socket socket=opened.accept()){
     try{handle(socket);}catch(Exception ignored){}
    }
   }catch(Exception ignored){
    int stopId;
    synchronized(lock){
     if(destroyed || generation!=listenerGeneration)return;
     starting=false;
     if(latestReady!=null)latestReady.send(1,null);
     latestReady=null;
     stopId=latestStartId;
    }
    stopSelf(stopId);
   }finally{
    if(opened!=null)try{opened.close();}catch(IOException ignored){}
    synchronized(lock){if(listener==opened)listener=null;}
   }
  },"loopback-callback").start();
 }

 private boolean equal(String a,String b){return a!=null && b!=null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),b.getBytes(StandardCharsets.UTF_8));}

 private void handle(Socket socket)throws Exception {
  socket.setSoTimeout(5000);
  final long requestAttempt;
  synchronized(lock){requestAttempt=attempt;}
  InputStream input=socket.getInputStream();ByteArrayOutputStream head=new ByteArrayOutputStream();int b;
  while(head.size()<16384 && (b=input.read())!=-1){head.write(b);byte[] bytes=head.toByteArray();int n=bytes.length;if(n>=4 && bytes[n-4]==13 && bytes[n-3]==10 && bytes[n-2]==13 && bytes[n-1]==10)break;}
  String[] lines=head.toString("UTF-8").split("\r\n");if(lines.length==0){reply(socket,403,"text/plain","Unavailable");return;}
  String[] first=lines[0].split(" ");Map<String,String> headers=new HashMap<>();
  for(int i=1;i<lines.length;i++){int colon=lines[i].indexOf(':');if(colon>0)headers.put(lines[i].substring(0,colon).toLowerCase(Locale.ROOT),lines[i].substring(colon+1).trim());}
  if(first.length!=3 || !"GET".equals(first[0]) || !first[1].startsWith("/") || !equal(headers.get("host"),"127.0.0.1:"+PORT)){reply(socket,403,"text/plain","Unavailable");return;}
  Uri u=Uri.parse("http://127.0.0.1:"+PORT+first[1]);
  if("/result".equals(u.getPath())){
   JSONObject value;
   int responseStatus;
   int stopId;
   synchronized(lock){
    if(requestAttempt!=attempt || !equal(headers.get("x-callback-state"),state) || headers.containsKey("origin")){
     value=null;responseStatus=403;stopId=-1;
    }else if(result==null || resultAttempt!=attempt){value=null;responseStatus=202;stopId=-1;}
    else{value=result;result=null;resultAttempt=-1;responseStatus=200;stopId=latestStartId;}
   }
   if(value==null){reply(socket,responseStatus,"application/json","{}");return;}
   reply(socket,200,"application/json",value.toString());
   stopSelf(stopId);
   return;
  }
  if(!"/auth/callback".equals(u.getPath())){reply(socket,403,"text/plain","Invalid sign-in return");return;}
  String callbackState=u.getQueryParameter("state");
  JSONObject value=new JSONObject();
  for(String key:new String[]{"state","code","client_id","error"}){String v=u.getQueryParameter(key);if(v!=null && v.length()<8192)value.put(key,v);}
  boolean accepted=false;
  synchronized(lock){
   if(requestAttempt==attempt && result==null && equal(callbackState,state)){
    result=value;
    resultAttempt=attempt;
    accepted=true;
   }
  }
  if(!accepted){reply(socket,403,"text/plain","Invalid sign-in return");return;}
  // No credential/code in the return link. Obsidian retrieves it through the protected local endpoint.
  reply(socket,200,"text/html","<!doctype html><meta name='viewport' content='width=device-width'><style>body{font:24px sans-serif;padding:32px}a{display:block;padding:20px;border:1px solid black;color:black}</style><h1>Sign-in returned</h1><p>Tap below to finish in Obsidian.</p><a href='obsidian://nomad-subscription-return'>Return to Obsidian</a>");
 }

 private void reply(Socket socket,int status,String type,String body)throws IOException{
  byte[] bytes=body.getBytes(StandardCharsets.UTF_8);String title=status==200?"OK":status==202?"Accepted":"Forbidden";
  OutputStream out=socket.getOutputStream();out.write(("HTTP/1.1 "+status+" "+title+"\r\nContent-Type: "+type+"; charset=utf-8\r\nContent-Length: "+bytes.length+"\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));out.write(bytes);out.flush();
 }

 @Override public void onDestroy(){
  handler.removeCallbacksAndMessages(null);
  synchronized(lock){
   destroyed=true;
   attempt++;
   listenerGeneration++;
   try{if(listener!=null)listener.close();}catch(IOException ignored){}
   listener=null;state=null;result=null;resultAttempt=-1;latestReady=null;
  }
  stopForeground(true);super.onDestroy();
 }
}
