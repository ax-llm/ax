FROM node:20

WORKDIR /app

# Install Prettier globally
RUN npm install -g prettier

# Set the default command to bash
CMD ["/bin/bash"]
