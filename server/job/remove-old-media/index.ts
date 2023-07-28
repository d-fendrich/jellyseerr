class RemoveOldMedia {
  private running: boolean;

  async run() {
    this.running = true;
  }

  status() {
    return {
      running: this.running,
    };
  }

  async cancel() {
    this.running = false;
  }
}

export const removeOldMedia = new RemoveOldMedia();
