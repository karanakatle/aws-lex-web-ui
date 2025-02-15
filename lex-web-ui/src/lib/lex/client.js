/*
 Copyright 2017-2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.

 Licensed under the Amazon Software License (the "License"). You may not use this file
 except in compliance with the License. A copy of the License is located at

 http://aws.amazon.com/asl/

 or in the "license" file accompanying this file. This file is distributed on an "AS IS"
 BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, express or implied. See the
 License for the specific language governing permissions and limitations under the License.
 */

/* eslint no-console: ["error", { allow: ["warn", "error"] }] */
const zlib = require('zlib');

function b64CompressedToObject(src) {
  return JSON.parse(zlib.unzipSync(Buffer.from(src, 'base64'))
    .toString('utf-8'));
}

function b64CompressedToString(src) {
  return zlib.unzipSync(Buffer.from(src, 'base64'))
    .toString('utf-8').replaceAll('"', '');
}

function compressAndB64Encode(src) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(src)))
    .toString('base64');
}

export default class {
  botV2Id;

  botV2AliasId;

  botV2LocaleId;

  isV2Bot;

  constructor({
    botName,
    botAlias = '$LATEST',
    userId,
    lexRuntimeClient,
    botV2Id,
    botV2AliasId,
    botV2LocaleId,
    lexRuntimeV2Client,
  }) {
    if (!botName || !lexRuntimeClient || !lexRuntimeV2Client
      || typeof botV2Id === 'undefined'
      || typeof botV2AliasId === 'undefined'
      || typeof botV2LocaleId === 'undefined'
    ) {
      console.error(`botName: ${botName} botV2Id: ${botV2Id} botV2AliasId ${botV2AliasId} `
        + `botV2LocaleId ${botV2LocaleId} lexRuntimeClient ${lexRuntimeClient} `
        + `lexRuntimeV2Client ${lexRuntimeV2Client}`);
      throw new Error('invalid lex client constructor arguments');
    }

    this.botName = botName;
    this.botAlias = botAlias;
    this.userId = userId
      || 'lex-web-ui-'
      + `${Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1)}`;

    this.botV2Id = botV2Id;
    this.botV2AliasId = botV2AliasId;
    this.botV2LocaleId = botV2LocaleId;
    this.isV2Bot = (this.botV2Id.length > 0);
    this.lexRuntimeClient = this.isV2Bot ? lexRuntimeV2Client : lexRuntimeClient;
    this.credentials = this.lexRuntimeClient.config.credentials;
  }

  initCredentials(credentials) {
    this.credentials = credentials;
    this.lexRuntimeClient.config.credentials = this.credentials;
    this.userId = (credentials.identityId)
      ? credentials.identityId
      : this.userId;
  }

  deleteSession() {
    let deleteSessionReq;
    if (this.isV2Bot) {
      deleteSessionReq = this.lexRuntimeClient.deleteSession({
        botAliasId: this.botV2AliasId,
        botId: this.botV2Id,
        localeId: this.botV2LocaleId,
        sessionId: this.userId,
      });
    } else {
      deleteSessionReq = this.lexRuntimeClient.deleteSession({
        botAlias: this.botAlias,
        botName: this.botName,
        userId: this.userId,
      });
    }
    return this.credentials.getPromise()
      .then((creds) => creds && this.initCredentials(creds))
      .then(() => deleteSessionReq.promise());
  }

  startNewSession() {
    let putSessionReq;
    if (this.isV2Bot) {
      putSessionReq = this.lexRuntimeClient.putSession({
        botAliasId: this.botV2AliasId,
        botId: this.botV2Id,
        localeId: this.botV2LocaleId,
        sessionId: this.userId,
        sessionState: {
          dialogAction: {
            type: 'ElicitIntent',
          },
        },
      });
    } else {
      putSessionReq = this.lexRuntimeClient.putSession({
        botAlias: this.botAlias,
        botName: this.botName,
        userId: this.userId,
        dialogAction: {
          type: 'ElicitIntent',
        },
      });
    }
    return this.credentials.getPromise()
      .then((creds) => creds && this.initCredentials(creds))
      .then(() => putSessionReq.promise());
  }

  postText(inputText, sessionAttributes = {}) {
    let postTextReq;
    if (this.isV2Bot) {
      postTextReq = this.lexRuntimeClient.recognizeText({
        botAliasId: this.botV2AliasId,
        botId: this.botV2Id,
        localeId: this.botV2LocaleId,
        sessionId: this.userId,
        text: inputText,
        sessionState: {
          sessionAttributes,
        },
      });
    } else {
      postTextReq = this.lexRuntimeClient.postText({
        botAlias: this.botAlias,
        botName: this.botName,
        userId: this.userId,
        inputText,
        sessionAttributes,
      });
    }
    return this.credentials.getPromise()
      .then((creds) => creds && this.initCredentials(creds))
      .then(async () => {
        const res = await postTextReq.promise();
        if (res.sessionState) { // this is v2 response
          res.sessionAttributes = res.sessionState.sessionAttributes;
          res.dialogState = res.sessionState.intent.state;
          const finalMessages = [];
          if (res.messages && res.messages.length > 0) {
            res.messages.forEach((mes) => {
              if (mes.contentType === 'ImageResponseCard') {
                res.responseCard = {};
                res.responseCard.version = '1';
                res.responseCard.contentType = 'application/vnd.amazonaws.card.generic';
                res.responseCard.genericAttachments = [];
                res.responseCard.genericAttachments.push(mes.imageResponseCard);
              } else {
                /* eslint-disable no-lonely-if */
                if (mes.contentType) { // push v1 style messages for use in the UI
                  const v1Format = { type: mes.contentType, value: mes.content };
                  finalMessages.push(v1Format);
                }
              }
            });
          }
          if (finalMessages.length > 0) {
            const msg = `{"messages": ${JSON.stringify(finalMessages)} }`;
            res.message = msg;
          }
        }
        return res;
      });
  }

  postContent(
    blob,
    sessionAttributes = {},
    acceptFormat = 'audio/ogg',
    offset = 0,
  ) {
    const mediaType = blob.type;
    let contentType = mediaType;

    if (mediaType.startsWith('audio/wav')) {
      contentType = 'audio/x-l16; sample-rate=16000; channel-count=1';
    } else if (mediaType.startsWith('audio/ogg')) {
      contentType = 'audio/x-cbr-opus-with-preamble; bit-rate=32000;'
        + ` frame-size-milliseconds=20; preamble-size=${offset}`;
    } else {
      console.warn('unknown media type in lex client');
    }
    let postContentReq;
    if (this.isV2Bot) {
      const sessionState = { sessionAttributes };
      postContentReq = this.lexRuntimeClient.recognizeUtterance({
        botAliasId: this.botV2AliasId,
        botId: this.botV2Id,
        localeId: this.botV2LocaleId,
        sessionId: this.userId,
        responseContentType: acceptFormat,
        requestContentType: contentType,
        inputStream: blob,
        sessionState: compressAndB64Encode(sessionState),
      });
    } else {
      postContentReq = this.lexRuntimeClient.postContent({
        accept: acceptFormat,
        botAlias: this.botAlias,
        botName: this.botName,
        userId: this.userId,
        contentType,
        inputStream: blob,
        sessionAttributes,
      });
    }
    return this.credentials.getPromise()
      .then((creds) => creds && this.initCredentials(creds))
      .then(async () => {
        const res = await postContentReq.promise();
        if (res.sessionState) {
          const oState = b64CompressedToObject(res.sessionState);
          res.sessionAttributes = oState.sessionAttributes ? oState.sessionAttributes : {};
          res.dialogState = oState.intent.state;
          res.inputTranscript = b64CompressedToString(res.inputTranscript);
          const finalMessages = [];
          if (res.messages && res.messages.length > 0) {
            res.messages = b64CompressedToObject(res.messages);
            res.messages.forEach((mes) => {
              if (mes.contentType === 'ImageResponseCard') {
                res.responseCard = {};
                res.responseCard.version = '1';
                res.responseCard.contentType = 'application/vnd.amazonaws.card.generic';
                res.responseCard.genericAttachments = [];
                res.responseCard.genericAttachments.push(mes.imageResponseCard);
              } else {
                /* eslint-disable no-lonely-if */
                if (mes.contentType) { // push v1 style messages for use in the UI
                  const v1Format = { type: mes.contentType, value: mes.content };
                  finalMessages.push(v1Format);
                }
              }
            });
          }
          if (finalMessages.length > 0) {
            const msg = `{"messages": ${JSON.stringify(finalMessages)} }`;
            res.message = msg;
          }
        }
        return res;
      });
  }
}
