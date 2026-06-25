# Integrazione IRSA per EKS

Questa guida descrive come eseguire CloudWatch Log Downloader come Pod EKS usando
IRSA, cioe IAM Roles for Service Accounts. Con IRSA il Pod non usa AWS SSO,
non monta `~/.aws` e non contiene token o chiavi statiche: l'AWS SDK riceve
credenziali temporanee dal ServiceAccount Kubernetes.

## Quando usare IRSA

Usare IRSA per deploy EKS stabili o di produzione.

Usare AWS SSO montando la cache `~/.aws` solo per Docker locale, test manuali o
demo temporanee. SSO richiede comunque una sessione interattiva o device login
quando il token non esiste o scade.

## Modifiche applicative richieste

Il codice supporta gia IRSA quando `aws.profile` non e configurato. In quel
caso l'app usa la credential chain standard AWS, che in EKS include WebIdentity.

Nel file di configurazione montato nel Pod impostare solo la regione:

```json
{
  "aws": {
    "region": "eu-central-1"
  }
}
```

Non configurare `aws.profile` nel Pod EKS:

```json
{
  "aws": {
    "region": "eu-central-1",
    "profile": "nome-profilo-sso"
  }
}
```

`config.prod.json` resta un file locale e non deve essere committato. Per EKS
va generato come ConfigMap o Secret a partire da valori approvati dal team
infrastrutturale.

Se la UI/API del monitor deve essere raggiungibile tramite Service Kubernetes,
configurare anche:

```json
{
  "monitor": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 3847
  }
}
```

## Permessi IAM minimi

Il ruolo IAM associato al ServiceAccount deve poter leggere i log CloudWatch e
verificare la propria identita.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:FilterLogEvents",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

Se il team vuole restringere `Resource`, validare prima i vincoli supportati
dalle API CloudWatch Logs usate. In molte installazioni si parte da `*` e si
limita per account/ambiente tramite naming, account boundary o policy gestite
dal team platform.

## ServiceAccount EKS

Creare o aggiornare un ServiceAccount nel namespace applicativo con annotazione
al ruolo IAM:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: cloudwatch-log-downloader
  namespace: osservabilita
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::<account-id>:role/<role-name>
```

Il ruolo IAM deve avere una trust policy verso l'OIDC provider del cluster EKS
e deve limitare il subject al ServiceAccount:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::<account-id>:oidc-provider/<eks-oidc-provider>"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "<eks-oidc-provider>:aud": "sts.amazonaws.com",
      "<eks-oidc-provider>:sub": "system:serviceaccount:osservabilita:cloudwatch-log-downloader"
    }
  }
}
```

## Deployment

Il Deployment deve usare il ServiceAccount IRSA e montare la configurazione
senza profilo SSO.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudwatch-log-downloader
  namespace: osservabilita
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cloudwatch-log-downloader
  template:
    metadata:
      labels:
        app: cloudwatch-log-downloader
    spec:
      serviceAccountName: cloudwatch-log-downloader
      containers:
        - name: cloudwatch-log-downloader
          image: <registry>/cloudwatch-log-downloader:<tag>
          env:
            - name: CONFIG_ENV
              value: prod
          ports:
            - name: http
              containerPort: 3847
          volumeMounts:
            - name: app-config
              mountPath: /app/config.prod.json
              subPath: config.prod.json
              readOnly: true
            - name: logs
              mountPath: /app/logs
          readinessProbe:
            httpGet:
              path: /api/v1/health
              port: http
            initialDelaySeconds: 15
            periodSeconds: 30
          livenessProbe:
            httpGet:
              path: /api/v1/health
              port: http
            initialDelaySeconds: 30
            periodSeconds: 60
      volumes:
        - name: app-config
          configMap:
            name: cloudwatch-log-downloader-config
        - name: logs
          emptyDir: {}
```

Tenere `replicas: 1`: piu repliche leggerebbero gli stessi log group e
scriverebbero file locali separati, duplicando lavoro e notifiche.

## Service opzionale

Se il monitor deve essere consultabile dentro il cluster:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: cloudwatch-log-downloader
  namespace: osservabilita
spec:
  selector:
    app: cloudwatch-log-downloader
  ports:
    - name: http
      port: 3847
      targetPort: http
```

## Validazione post deploy

Controlli attesi:

```bash
kubectl -n osservabilita get pod -l app=cloudwatch-log-downloader
kubectl -n osservabilita logs deploy/cloudwatch-log-downloader
kubectl -n osservabilita exec deploy/cloudwatch-log-downloader -- env | grep AWS_
kubectl -n osservabilita port-forward svc/cloudwatch-log-downloader 3847:3847
curl http://127.0.0.1:3847/api/v1/health
```

Nel Pod IRSA sono normali variabili come `AWS_ROLE_ARN` e
`AWS_WEB_IDENTITY_TOKEN_FILE`. Non deve invece esserci bisogno di `AWS_PROFILE`
o di una directory `.aws` montata.

## Troubleshooting

`AccessDeniedException` o `UnrecognizedClientException`:
verificare annotazione del ServiceAccount, trust policy OIDC, namespace e nome
del ServiceAccount nella condition `sub`.

`Configuration file not found`:
verificare mount di `config.prod.json` in `/app/config.prod.json` e
`CONFIG_ENV=prod`.

Monitor non raggiungibile:
verificare `monitor.host: "0.0.0.0"`, Service Kubernetes e probe su porta
`3847`.

Nessun log scaricato:
verificare regione, nomi/prefix dei log group, permessi IAM e finestra
`logGroupDiscovery.activeWindowHours`.

## Checklist per handoff EKS

- `config.prod.json` montato nel Pod, non committato.
- `aws.region` presente.
- `aws.profile` assente.
- `monitor.host` impostato a `0.0.0.0` se serve esporre UI/API.
- ServiceAccount annotato con ruolo IAM.
- Trust policy IRSA limitata al namespace e ServiceAccount corretti.
- Policy IAM con permessi CloudWatch Logs e `sts:GetCallerIdentity`.
- Deployment con `replicas: 1`.
- Probe su `GET /api/v1/health`.
